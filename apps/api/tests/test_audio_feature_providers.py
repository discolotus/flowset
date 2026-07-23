import json
import sys
from pathlib import Path
from types import ModuleType

import httpx
import pytest

from playlist_optimizer.analysis_progress import AnalysisProgressRegistry
from playlist_optimizer.models import (
    AudioFeatureProvenance,
    AudioFeatureResolutionRequest,
    AudioFeatures,
    Track,
)
from playlist_optimizer.providers.essentia import (
    EssentiaAnalysis,
    EssentiaProvider,
    InProcessTensorflowMoodRunner,
    LazyEssentiaMusicExtractor,
    TensorflowMoodAnalysis,
)
from playlist_optimizer.providers.reccobeats import ReccoBeatsProvider


def _track(spotify_id: str) -> Track:
    return Track(
        id=spotify_id,
        uri=f"spotify:track:{spotify_id}",
        name=f"Track {spotify_id}",
        artist="Test Artist",
        album="Test Album",
        duration_ms=180_000,
    )


def _reccobeats_features(spotify_id: str) -> dict[str, object]:
    return {
        "id": f"recco-{spotify_id}",
        "href": f"https://open.spotify.com/track/{spotify_id}",
        "isrc": "TEST12345678",
        "acousticness": 0.1,
        "danceability": 0.7,
        "energy": 0.8,
        "instrumentalness": 0.2,
        "key": 6,
        "liveness": 0.15,
        "loudness": -6.5,
        "mode": 1,
        "speechiness": 0.04,
        "tempo": 126.0,
        "valence": 0.6,
    }


def test_reccobeats_batches_by_40_matches_by_href_and_retains_misses() -> None:
    spotify_ids = [f"{index:022d}" for index in range(41)]
    requested_batches: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        ids = request.url.params["ids"].split(",")
        requested_batches.append(ids)
        # ReccoBeats may omit misses and return content in a different order.
        content = [
            _reccobeats_features(spotify_id) for spotify_id in reversed(ids) if int(spotify_id) % 2
        ]
        return httpx.Response(200, json={"content": content})

    client = httpx.Client(
        base_url="https://api.reccobeats.test",
        transport=httpx.MockTransport(handler),
    )
    provider = ReccoBeatsProvider(client=client)

    result = provider.resolve(
        AudioFeatureResolutionRequest(
            provider="reccobeats",
            tracks=[_track(spotify_id) for spotify_id in spotify_ids],
        )
    )

    assert [len(batch) for batch in requested_batches] == [40, 1]
    assert result.status == "partial"
    assert result.analyzed_track_count == 20
    assert len(result.tracks) == 41
    assert len(result.unavailable_track_ids) == 21
    resolved = result.tracks[1]
    assert resolved.audio_features is not None
    assert resolved.audio_features.tempo == 126.0
    assert resolved.audio_features.time_signature is None
    assert resolved.audio_feature_provenance is not None
    assert resolved.audio_feature_provenance.provider == "reccobeats"
    assert result.tracks[0].audio_features is None


def test_reccobeats_retries_429_using_retry_after() -> None:
    spotify_id = "1234567890123456789012"
    request_count = 0
    sleeps: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count == 1:
            return httpx.Response(429, headers={"Retry-After": "0.25"})
        return httpx.Response(200, json={"content": [_reccobeats_features(spotify_id)]})

    provider = ReccoBeatsProvider(
        client=httpx.Client(
            base_url="https://api.reccobeats.test",
            transport=httpx.MockTransport(handler),
        ),
        sleeper=sleeps.append,
        max_rate_limit_retries=1,
    )

    result = provider.resolve(
        AudioFeatureResolutionRequest(provider="reccobeats", tracks=[_track(spotify_id)])
    )

    assert result.status == "complete"
    assert request_count == 2
    assert sleeps == [0.25]


def test_reccobeats_honors_retry_after_longer_than_ten_seconds() -> None:
    spotify_id = "1234567890123456789012"
    request_count = 0
    sleeps: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count == 1:
            return httpx.Response(429, headers={"Retry-After": "15"})
        return httpx.Response(200, json={"content": [_reccobeats_features(spotify_id)]})

    provider = ReccoBeatsProvider(
        client=httpx.Client(
            base_url="https://api.reccobeats.test",
            transport=httpx.MockTransport(handler),
        ),
        sleeper=sleeps.append,
        max_rate_limit_retries=1,
    )

    result = provider.resolve(
        AudioFeatureResolutionRequest(provider="reccobeats", tracks=[_track(spotify_id)])
    )

    assert result.status == "complete"
    assert sleeps == [15]


def test_reccobeats_can_resolve_an_isrc_without_a_spotify_id() -> None:
    requested_identifiers: list[str] = []
    track = Track(
        id="internal-track-id",
        name="ISRC-only track",
        artist="Test Artist",
        album="Test Album",
        duration_ms=180_000,
        isrc="usrc12345678",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        requested_identifiers.extend(request.url.params["ids"].split(","))
        item = _reccobeats_features("1234567890123456789012")
        item["isrc"] = "USRC12345678"
        return httpx.Response(200, json={"content": [item]})

    provider = ReccoBeatsProvider(
        client=httpx.Client(
            base_url="https://api.reccobeats.test",
            transport=httpx.MockTransport(handler),
        )
    )

    result = provider.resolve(AudioFeatureResolutionRequest(provider="reccobeats", tracks=[track]))

    assert requested_identifiers == ["USRC12345678"]
    assert result.status == "complete"
    assert result.tracks[0].audio_features is not None
    assert result.tracks[0].audio_features.tempo == 126


def test_reccobeats_does_not_keep_stale_features_for_a_catalog_miss() -> None:
    spotify_id = "1234567890123456789012"
    track = _track(spotify_id).model_copy(
        update={
            "audio_features": AudioFeatures(tempo=120),
            "audio_feature_provenance": AudioFeatureProvenance(provider="essentia"),
        }
    )
    provider = ReccoBeatsProvider(
        client=httpx.Client(
            base_url="https://api.reccobeats.test",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"content": []})),
        )
    )

    result = provider.resolve(AudioFeatureResolutionRequest(provider="reccobeats", tracks=[track]))

    assert result.tracks[0].audio_features is None
    assert result.tracks[0].audio_feature_provenance is None


class _FakeEssentiaAnalyzer:
    is_available = True
    unavailable_reason = None

    def __init__(self) -> None:
        self.paths: list[Path] = []

    def analyze(self, path: Path) -> EssentiaAnalysis:
        self.paths.append(path)
        return EssentiaAnalysis(
            features=AudioFeatures(
                tempo=128,
                key=9,
                mode=0,
                danceability=0.72,
                loudness=-8.2,
                loudness_range=5.1,
                onset_rate=4.8,
                beat_strength=0.013,
                dynamic_complexity=3.4,
                brightness=2_450.0,
                spectral_flux=0.08,
                key_strength=0.73,
            ),
            analyzer_version="test-version",
            notes=("Test analyzer output.",),
        )


class _UnavailableEssentiaAnalyzer:
    is_available = False
    unavailable_reason = "Essentia is not installed for this test."

    def analyze(self, path: Path) -> EssentiaAnalysis:
        raise AssertionError(f"should not analyze {path}")


class _FailingMoodRunner:
    def analyze(self, path: Path, model_dir: Path) -> object:
        raise RuntimeError(f"simulated mood failure for {path} using {model_dir}")


def _write_complete_model_bundle(model_dir: Path) -> None:
    model_dir.mkdir()
    (model_dir / "msd-musicnn-1.pb").write_bytes(b"embedding")
    definitions = {
        "deam-msd-musicnn-2": ("model/Identity", ["valence", "arousal"]),
        "mood_aggressive-msd-musicnn-1": (
            "model/Softmax",
            ["aggressive", "not_aggressive"],
        ),
        "mood_party-msd-musicnn-1": ("model/Softmax", ["non_party", "party"]),
        "mood_relaxed-msd-musicnn-1": ("model/Softmax", ["non_relaxed", "relaxed"]),
    }
    for stem, (output_name, classes) in definitions.items():
        (model_dir / f"{stem}.pb").write_bytes(b"head")
        (model_dir / f"{stem}.json").write_text(
            json.dumps(
                {
                    "classes": classes,
                    "schema": {"outputs": [{"name": output_name, "output_purpose": "predictions"}]},
                }
            ),
            encoding="utf-8",
        )


def test_essentia_analyzes_only_supplied_files_and_reports_partial(tmp_path: Path) -> None:
    audio_path = tmp_path / "track-one.wav"
    audio_path.write_bytes(b"fixture")
    analyzer = _FakeEssentiaAnalyzer()
    progress_registry = AnalysisProgressRegistry()
    provider = EssentiaProvider(
        audio_root=tmp_path,
        analyzer=analyzer,
        progress_registry=progress_registry,
    )
    tracks = [_track("1111111111111111111111"), _track("2222222222222222222222")]

    result = provider.resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=tracks,
            local_audio_paths={tracks[0].id: audio_path.name},
            progress_token="provider-progress-token",
        )
    )

    assert result.status == "partial"
    assert result.analyzed_track_count == 1
    assert analyzer.paths == [audio_path]
    assert result.tracks[0].audio_features == AudioFeatures(
        tempo=128,
        key=9,
        mode=0,
        danceability=0.72,
        loudness=-8.2,
        loudness_range=5.1,
        onset_rate=4.8,
        beat_strength=0.013,
        dynamic_complexity=3.4,
        brightness=2_450.0,
        spectral_flux=0.08,
        key_strength=0.73,
    )
    assert result.tracks[0].audio_features.energy is None
    assert result.tracks[0].audio_features.arousal is None
    assert result.tracks[0].audio_features.aggressiveness is None
    assert result.tracks[0].audio_features.party is None
    assert result.tracks[0].audio_features.relaxed is None
    assert result.tracks[0].audio_features.valence is None
    assert result.tracks[0].audio_feature_provenance is not None
    assert result.tracks[0].audio_feature_provenance.source_id == audio_path.name
    assert result.tracks[0].audio_feature_provenance.analyzer_version == "test-version"
    assert result.tracks[1] == tracks[1]
    assert result.unavailable_track_ids == [tracks[1].id]
    progress = progress_registry.get("provider-progress-token")
    assert progress is not None
    assert progress.phase == "complete"
    assert progress.completed_track_count == 2
    assert progress.successful_track_count == 1
    assert progress.failed_track_count == 1
    assert progress.tracks[0].stages.native_dsp.state == "complete"
    assert progress.tracks[0].stages.tensorflow.state == "skipped"
    assert progress.tracks[1].status == "unavailable"


def test_essentia_sanitizes_audio_and_model_roots_from_response_and_cache_notes(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Private Music"
    model_dir = tmp_path / "Private Models"
    music_root.mkdir()
    model_dir.mkdir()
    (music_root / "track.wav").write_bytes(b"fixture")

    class _PathLeakingAnalyzer(_FakeEssentiaAnalyzer):
        def analyze(self, path: Path) -> EssentiaAnalysis:
            return EssentiaAnalysis(
                features=AudioFeatures(
                    tempo=124,
                    arousal=0.6,
                    valence=0.5,
                    aggressiveness=0.4,
                    party=0.7,
                    relaxed=0.3,
                ),
                analyzer_version="test-version",
                notes=(f"decoder mentioned {path}; model mentioned {model_dir / 'head.pb'}",),
            )

    track = _track("path-note-track")
    result = EssentiaProvider(
        audio_root=music_root,
        model_dir=model_dir,
        analyzer=_PathLeakingAnalyzer(),
    ).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths={track.id: "track.wav"},
            analysis_cache_directories={track.id: [""]},
        )
    )

    provenance = result.tracks[0].audio_feature_provenance
    assert provenance is not None
    note = provenance.notes[0]
    assert str(music_root) not in note
    assert str(model_dir) not in note
    assert "ESSENTIA_AUDIO_ROOT" in note
    assert "ESSENTIA_MODEL_DIR" in note
    cache_text = (music_root / ".sequence" / "analysis-cache.json").read_text(encoding="utf-8")
    assert str(music_root) not in cache_text
    assert str(model_dir) not in cache_text


def test_essentia_music_extractor_maps_native_descriptors_without_normalizing_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = {
        "rhythm.bpm": 126.0,
        "rhythm.danceability": 1.5,
        "rhythm.onset_rate": 4.8,
        "rhythm.beats_loudness.mean": 0.013,
        "lowlevel.loudness_ebu128.integrated": -8.2,
        "lowlevel.loudness_ebu128.loudness_range": 5.1,
        "lowlevel.dynamic_complexity": 3.4,
        "lowlevel.spectral_centroid.mean": 2_450.0,
        "lowlevel.spectral_flux.mean": 0.08,
        "tonal.key_edma.key": "F#",
        "tonal.key_edma.scale": "minor",
        "tonal.key_edma.strength": 0.73,
    }
    captured_options: dict[str, object] = {}

    def music_extractor(**options: object) -> object:
        captured_options.update(options)
        return lambda _: (pool, {})

    essentia_module = ModuleType("essentia")
    essentia_module.__path__ = []  # type: ignore[attr-defined]
    essentia_module.__version__ = "test-version"  # type: ignore[attr-defined]
    standard_module = ModuleType("essentia.standard")
    standard_module.MusicExtractor = music_extractor  # type: ignore[attr-defined]
    essentia_module.standard = standard_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "essentia", essentia_module)
    monkeypatch.setitem(sys.modules, "essentia.standard", standard_module)
    monkeypatch.setattr(
        "playlist_optimizer.providers.essentia.importlib.util.find_spec",
        lambda _: object(),
    )

    analysis = LazyEssentiaMusicExtractor().analyze(Path("fixture.mp3"))

    assert captured_options == {
        "lowlevelStats": ["mean", "stdev"],
        "rhythmStats": ["mean", "stdev"],
        "tonalStats": ["mean", "stdev"],
    }
    assert analysis.features == AudioFeatures(
        tempo=126.0,
        key=6,
        mode=0,
        danceability=0.5,
        loudness=-8.2,
        loudness_range=5.1,
        onset_rate=4.8,
        beat_strength=0.013,
        dynamic_complexity=3.4,
        brightness=2_450.0,
        spectral_flux=0.08,
        key_strength=0.73,
    )
    assert analysis.features.arousal is None
    assert analysis.features.aggressiveness is None
    assert analysis.features.party is None
    assert analysis.features.relaxed is None
    assert analysis.features.valence is None
    assert analysis.analyzer_version == "test-version"
    assert any("ESSENTIA_MODEL_DIR is not configured" in note for note in analysis.notes)


def test_lazy_essentia_reports_native_and_tensorflow_only_while_each_stage_runs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "models"
    _write_complete_model_bundle(model_dir)
    registry = AnalysisProgressRegistry()
    track = _track("progress-stage-track")
    reporter = registry.begin("progress-stage-token", "essentia", [track])
    reporter.track_started(track)
    observed_phases: list[str] = []

    def extract(_: str) -> tuple[dict[str, object], dict[str, object]]:
        snapshot = registry.get("progress-stage-token")
        assert snapshot is not None
        observed_phases.append(snapshot.phase)
        assert snapshot.tracks[0].stages.native_dsp.state == "active"
        return ({"rhythm.bpm": 124.0}, {})

    class _InspectingMoodRunner:
        def analyze(self, path: Path, selected_model_dir: Path) -> TensorflowMoodAnalysis:
            assert path == Path("fixture.mp3")
            assert selected_model_dir == model_dir
            snapshot = registry.get("progress-stage-token")
            assert snapshot is not None
            observed_phases.append(snapshot.phase)
            assert snapshot.tracks[0].stages.native_dsp.state == "complete"
            assert snapshot.tracks[0].stages.tensorflow.state == "active"
            return TensorflowMoodAnalysis(
                features={
                    "arousal": 0.6,
                    "valence": 0.5,
                    "aggressiveness": 0.4,
                    "party": 0.7,
                    "relaxed": 0.3,
                },
                notes=("Test mood output.",),
                worker_pid=123,
            )

    essentia_module = ModuleType("essentia")
    essentia_module.__path__ = []  # type: ignore[attr-defined]
    essentia_module.__version__ = "test-version"  # type: ignore[attr-defined]
    standard_module = ModuleType("essentia.standard")
    standard_module.MusicExtractor = lambda **_: extract  # type: ignore[attr-defined]
    essentia_module.standard = standard_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "essentia", essentia_module)
    monkeypatch.setitem(sys.modules, "essentia.standard", standard_module)
    monkeypatch.setattr(
        "playlist_optimizer.providers.essentia.importlib.util.find_spec",
        lambda _: object(),
    )

    analysis = LazyEssentiaMusicExtractor(
        model_dir=model_dir,
        mood_runner=_InspectingMoodRunner(),
    ).analyze_with_progress(Path("fixture.mp3"), reporter)

    assert observed_phases == ["native_dsp", "tensorflow"]
    assert analysis.features.arousal == 0.6
    snapshot = registry.get("progress-stage-token")
    assert snapshot is not None
    assert snapshot.tracks[0].stages.native_dsp.state == "complete"
    assert snapshot.tracks[0].stages.tensorflow.state == "complete"


def test_native_essentia_features_survive_an_isolated_mood_worker_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "models"
    _write_complete_model_bundle(model_dir)
    pool = {
        "rhythm.bpm": 124.0,
        "rhythm.danceability": 1.8,
        "lowlevel.loudness_ebu128.integrated": -9.2,
        "tonal.key_edma.key": "A",
        "tonal.key_edma.scale": "minor",
    }

    essentia_module = ModuleType("essentia")
    essentia_module.__path__ = []  # type: ignore[attr-defined]
    essentia_module.__version__ = "test-version"  # type: ignore[attr-defined]
    standard_module = ModuleType("essentia.standard")
    standard_module.MusicExtractor = lambda **_: lambda _: (pool, {})  # type: ignore[attr-defined]
    essentia_module.standard = standard_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "essentia", essentia_module)
    monkeypatch.setitem(sys.modules, "essentia.standard", standard_module)
    monkeypatch.setattr(
        "playlist_optimizer.providers.essentia.importlib.util.find_spec",
        lambda _: object(),
    )

    audio_path = tmp_path / "Private Music" / "fixture.mp3"
    analysis = LazyEssentiaMusicExtractor(
        model_dir=model_dir,
        mood_runner=_FailingMoodRunner(),
    ).analyze(audio_path)

    assert analysis.features.tempo == 124.0
    assert analysis.features.key == 9
    assert analysis.features.danceability == pytest.approx(0.6)
    assert analysis.features.loudness == -9.2
    assert analysis.features.arousal is None
    assert analysis.features.valence is None
    assert analysis.features.aggressiveness is None
    assert analysis.features.party is None
    assert analysis.features.relaxed is None
    assert any("native Essentia features were retained" in note for note in analysis.notes)
    assert all(str(tmp_path) not in note for note in analysis.notes)
    assert any("LOCAL_AUDIO_FILE" in note for note in analysis.notes)
    assert any("ESSENTIA_MODEL_DIR" in note for note in analysis.notes)


def test_essentia_model_bundle_requires_complete_nonempty_valid_artifacts(tmp_path: Path) -> None:
    model_dir = tmp_path / "models"
    _write_complete_model_bundle(model_dir)
    analyzer = LazyEssentiaMusicExtractor(model_dir=model_dir)

    assert analyzer.model_unavailable_reason is None

    graph = model_dir / "mood_party-msd-musicnn-1.pb"
    graph.write_bytes(b"")
    assert "contains empty files" in (analyzer.model_unavailable_reason or "")

    graph.write_bytes(b"head")
    metadata = model_dir / "mood_party-msd-musicnn-1.json"
    metadata.write_text("not-json", encoding="utf-8")
    assert "Could not read Essentia model metadata" in (analyzer.model_unavailable_reason or "")


def test_essentia_reports_bundled_mood_models_ready_before_library_selection(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "models"
    _write_complete_model_bundle(model_dir)
    monkeypatch.setattr(
        "playlist_optimizer.providers.essentia.importlib.util.find_spec",
        lambda _: object(),
    )

    info = EssentiaProvider(audio_root=None, model_dir=model_dir).info()

    assert info.status == "unavailable"
    assert "ESSENTIA_AUDIO_ROOT is not configured" in info.detail
    assert "TensorFlow arousal, valence, aggressiveness, party, and relaxed scores are active" in (
        info.detail
    )


def test_tensorflow_worker_runs_all_mood_heads_using_metadata_class_order(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "msd-musicnn-1.pb").write_bytes(b"embedding")
    model_metadata = {
        "deam-msd-musicnn-2": {
            "name": "arousal_valence",
            "version": "2",
            "classes": ["valence", "arousal"],
            "schema": {"outputs": [{"name": "model/Identity", "output_purpose": "predictions"}]},
        },
        "mood_aggressive-msd-musicnn-1": {
            "name": "mood aggressive",
            "version": "2",
            "classes": ["aggressive", "not_aggressive"],
            "schema": {"outputs": [{"name": "model/Softmax", "output_purpose": "predictions"}]},
        },
        "mood_party-msd-musicnn-1": {
            "name": "mood party",
            "version": "2",
            "classes": ["non_party", "party"],
            "schema": {"outputs": [{"name": "model/Softmax", "output_purpose": "predictions"}]},
        },
        "mood_relaxed-msd-musicnn-1": {
            "name": "mood relaxed",
            "version": "2",
            "classes": ["non_relaxed", "relaxed"],
            "schema": {"outputs": [{"name": "model/Softmax", "output_purpose": "predictions"}]},
        },
    }
    for stem, metadata in model_metadata.items():
        (model_dir / f"{stem}.pb").write_bytes(b"head")
        (model_dir / f"{stem}.json").write_text(json.dumps(metadata), encoding="utf-8")

    pool = {
        "rhythm.bpm": 126.0,
        "rhythm.danceability": 1.5,
        "tonal.key_edma.key": "F#",
        "tonal.key_edma.scale": "minor",
    }
    calls: list[tuple[str, dict[str, object]]] = []

    def music_extractor(**_: object) -> object:
        return lambda _: (pool, {})

    def mono_loader(**options: object) -> object:
        calls.append(("loader", options))
        return lambda: [0.0, 0.1]

    def musicnn(**options: object) -> object:
        calls.append(("musicnn", options))
        return lambda _: [[0.1] * 200, [0.2] * 200]

    def predict_2d(**options: object) -> object:
        calls.append(("head", options))
        graph_name = Path(str(options["graphFilename"])).name
        outputs = {
            "deam-msd-musicnn-2.pb": [[5.0, 7.0], [7.0, 5.0]],
            "mood_aggressive-msd-musicnn-1.pb": [[0.8, 0.2], [0.6, 0.4]],
            "mood_party-msd-musicnn-1.pb": [[0.1, 0.9], [0.3, 0.7]],
            "mood_relaxed-msd-musicnn-1.pb": [[0.8, 0.2], [0.6, 0.4]],
        }
        return lambda _: outputs[graph_name]

    essentia_module = ModuleType("essentia")
    essentia_module.__path__ = []  # type: ignore[attr-defined]
    essentia_module.__version__ = "test-tensorflow-version"  # type: ignore[attr-defined]
    standard_module = ModuleType("essentia.standard")
    standard_module.MusicExtractor = music_extractor  # type: ignore[attr-defined]
    standard_module.MonoLoader = mono_loader  # type: ignore[attr-defined]
    standard_module.TensorflowPredictMusiCNN = musicnn  # type: ignore[attr-defined]
    standard_module.TensorflowPredict2D = predict_2d  # type: ignore[attr-defined]
    essentia_module.standard = standard_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "essentia", essentia_module)
    monkeypatch.setitem(sys.modules, "essentia.standard", standard_module)
    monkeypatch.setattr(
        "playlist_optimizer.providers.essentia.importlib.util.find_spec",
        lambda _: object(),
    )

    analysis = InProcessTensorflowMoodRunner().analyze(Path("fixture.mp3"), model_dir)

    assert analysis.features["arousal"] == pytest.approx(0.625)
    assert analysis.features["valence"] == pytest.approx(0.625)
    assert analysis.features["aggressiveness"] == pytest.approx(0.7)
    assert analysis.features["party"] == pytest.approx(0.8)
    assert analysis.features["relaxed"] == pytest.approx(0.3)
    assert calls[0] == ("loader", {"filename": "fixture.mp3", "sampleRate": 16_000})
    assert calls[1][0] == "musicnn"
    assert calls[1][1]["output"] == "model/dense/BiasAdd"
    assert len([call for call in calls if call[0] == "musicnn"]) == 1
    assert len([call for call in calls if call[0] == "head"]) == 4
    assert len([call for call in calls if call[0] == "loader"]) == 1
    assert any("shared msd-musicnn-1 embedding pass" in note for note in analysis.notes)


def test_essentia_caps_synchronous_analysis_to_five_tracks(tmp_path: Path) -> None:
    analyzer = _FakeEssentiaAnalyzer()
    provider = EssentiaProvider(audio_root=tmp_path, analyzer=analyzer)
    tracks = [_track(f"{index:022d}") for index in range(6)]

    result = provider.resolve(AudioFeatureResolutionRequest(provider="essentia", tracks=tracks))

    assert result.status == "failed"
    assert result.analyzed_track_count == 0
    assert analyzer.paths == []
    assert "at most 5 tracks" in result.warnings[0]


def test_essentia_degrades_clearly_when_optional_dependency_is_unavailable(
    tmp_path: Path,
) -> None:
    provider = EssentiaProvider(
        audio_root=tmp_path,
        analyzer=_UnavailableEssentiaAnalyzer(),
    )
    track = _track("3333333333333333333333")

    assert provider.info().status == "unavailable"
    result = provider.resolve(AudioFeatureResolutionRequest(provider="essentia", tracks=[track]))

    assert result.status == "unavailable"
    assert result.tracks == [track]
    assert result.unavailable_track_ids == [track.id]
    assert result.warnings == ["Essentia is not installed for this test."]


def test_essentia_rejects_audio_paths_outside_configured_root(tmp_path: Path) -> None:
    provider = EssentiaProvider(audio_root=tmp_path, analyzer=_FakeEssentiaAnalyzer())
    track = _track("4444444444444444444444")

    result = provider.resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths={track.id: "../outside.wav"},
        )
    )

    assert result.status == "unavailable"
    assert "escapes ESSENTIA_AUDIO_ROOT" in result.warnings[0]


def test_essentia_does_not_keep_stale_features_without_local_audio(tmp_path: Path) -> None:
    track = _track("5555555555555555555555").model_copy(
        update={
            "audio_features": AudioFeatures(energy=0.9),
            "audio_feature_provenance": AudioFeatureProvenance(provider="reccobeats"),
        }
    )
    provider = EssentiaProvider(audio_root=tmp_path, analyzer=_FakeEssentiaAnalyzer())

    result = provider.resolve(AudioFeatureResolutionRequest(provider="essentia", tracks=[track]))

    assert result.tracks[0].audio_features is None
    assert result.tracks[0].audio_feature_provenance is None
