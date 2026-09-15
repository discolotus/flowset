import { useMemo, useState } from "react";
import { localAudioPreviewUrl } from "../lib/api";
import type { Track } from "../lib/types";
import catalog from "../lib/learning/essentiaCatalog.json";
import { essentiaFields, learningPackages, type FeatureScope, type LearningPackageId } from "../lib/learning/packages";

interface AlgorithmInterface {
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  parameters: { name: string; type: string }[];
}
interface AlgorithmEntry { name: string; category: string; modes: string[]; interfaces: Record<string, AlgorithmInterface | undefined>; }
const algorithms: AlgorithmEntry[] = catalog.algorithms;

interface Props { tracks: Track[]; audioPaths: Record<string, string>; onOpenBuilder: () => void; onOpenLab: () => void; }
const toyTracks = [{name:"Fictional Amber", angle:20}, {name:"Fictional Birch", angle:85}, {name:"Fictional Cobalt", angle:155}];
export function illustrativeSimilarity(a: number, b: number) { return Math.cos((a-b)*Math.PI/180); }
const external = { target: "_blank", rel: "noreferrer" } as const;

function SimilarityDemo({ reference }: { reference: boolean }) {
  const [angle, setAngle] = useState(25);
  const scores = toyTracks.map(track=>({...track,score:illustrativeSimilarity(angle,track.angle)})).sort((a,b)=>b.score-a.score);
  const point = (degrees: number) => ({x:150+105*Math.cos(degrees*Math.PI/180),y:140-105*Math.sin(degrees*Math.PI/180)});
  const query = point(angle);
  return <div className="learn-demo">
    <div><p className="eyebrow">Interactive illustration · fictional vectors</p><h3>{reference ? "A reference song becomes a direction" : "A prompt becomes a direction"}</h3>
      <p>Move the query and watch the ranking change. This computes cosine similarity in two dimensions. Real embeddings have many more dimensions; these dots and scores are invented, and no model runs here.</p>
      {reference ? <label>Illustrative reference<select aria-label="Illustrative reference" value={angle} onChange={event=>setAngle(Number(event.target.value))}>{toyTracks.map(track=><option key={track.name} value={track.angle}>{track.name}</option>)}<option value={25}>Custom starting reference</option></select></label> : <label>Query direction: {angle}°<input aria-label="Query direction" type="range" min="0" max="180" value={angle} onChange={event=>setAngle(Number(event.target.value))}/></label>}
      <ol aria-label="Illustrative similarity ranking">{scores.map(track=><li key={track.name}><span>{track.name}</span><output>{track.score.toFixed(3)}</output></li>)}</ol>
      <p className="learn-note">cosine(a, b) = (a · b) / (‖a‖ ‖b‖). The axes have no fixed musical meaning. Real MuQ-MuLan may also scale its similarity output.</p>
    </div>
    <svg viewBox="0 0 300 175" role="img" aria-label="Fictional vector directions on a semicircle">
      <path d="M45 140 A105 105 0 0 1 255 140" fill="none" stroke="currentColor" opacity=".2"/>
      {toyTracks.map(track=>{const p=point(track.angle);return <g key={track.name}><line x1="150" y1="140" x2={p.x} y2={p.y} stroke="currentColor" opacity=".25"/><circle cx={p.x} cy={p.y} r="5" fill="currentColor"/><text x={p.x} y={p.y-12} textAnchor="middle" fill="currentColor" fontSize="9">{track.name.replace("Fictional ","")}</text></g>;})}
      <line x1="150" y1="140" x2={query.x} y2={query.y} stroke="#d5ff70" strokeWidth="3"/><circle cx={query.x} cy={query.y} r="7" fill="#d5ff70"/><text x="150" y="165" textAnchor="middle" fill="#d5ff70" fontSize="11">Query / reference</text>
    </svg>
  </div>;
}
function SignalDemo() {
  const [amplitude,setAmplitude]=useState(0.5);
  const samples=Array.from({length:256},(_,i)=>amplitude*Math.sin(2*Math.PI*4*i/256));
  const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
  return <div className="learn-demo"><div><p className="eyebrow">Interactive illustration · synthetic signal</p><h3>Measure a waveform</h3><p>RMS measures average signal magnitude. Raising amplitude increases RMS even though the waveform’s frequency stays the same. This browser calculation teaches the RMS algorithm; it is not Essentia inference or a mood estimate.</p>
    <label>Signal amplitude: {amplitude.toFixed(2)}<input aria-label="Signal amplitude" type="range" min="0" max="1" step="0.05" value={amplitude} onChange={event=>setAmplitude(Number(event.target.value))}/></label>
    <p><strong>RMS: <output aria-label="Calculated RMS">{rms.toFixed(4)}</output></strong> · √mean(sample²)</p><a {...external} href="https://essentia.upf.edu/reference/std_RMS.html">Read the RMS algorithm documentation ↗</a></div>
    <svg viewBox="0 0 300 160" role="img" aria-label="Synthetic sine waveform"><line x1="0" y1="80" x2="300" y2="80" stroke="currentColor" opacity=".25"/><polyline points={samples.map((x,i)=>`${i*300/255},${80-x*65}`).join(" ")} fill="none" stroke="#d5ff70" strokeWidth="2"/></svg></div>;
}
function MeasurementDemo({tracks,audioPaths}: Pick<Props,"tracks"|"audioPaths">) {
  const [trackId,setTrackId]=useState("");
  const track=tracks.find(item=>item.id===trackId);
  return <section className="learn-card" aria-labelledby="measurements-heading"><p className="eyebrow">Your selected library · existing results</p><h3 id="measurements-heading">Inspect actual measurements</h3><p>Choose a track to inspect all 17 Essentia fields. Values are read from the selected source pool; opening this inspector does not run analysis.</p>
    <label>Track to inspect<select aria-label="Track to inspect" value={track?.id??""} onChange={event=>setTrackId(event.target.value)}><option value="">Choose one of {tracks.length} selected tracks</option>{tracks.map(item=><option key={item.id} value={item.id}>{item.name} — {item.artist}</option>)}</select></label>
    {tracks.length===0 && <p className="learn-note">Import or select tracks in Playlist Builder first.</p>}
    {track && <><p className="learn-note">Provider: {track.audio_feature_provenance?.provider??"unknown / not analyzed"} · analyzer: {track.audio_feature_provenance?.analyzer_version??"not recorded"}. Fixture values are fictional; values from another provider are not Essentia results.</p>
      {audioPaths[track.id] && <audio controls preload="none" aria-label={`Learning preview ${track.name}`} src={localAudioPreviewUrl(audioPaths[track.id])}/>}
      <dl className="learn-measurements">{essentiaFields.map(([key,label,unit])=><div key={key}><dt>{label}</dt><dd>{track.audio_features?.[key]==null ? "Not available" : Number(track.audio_features[key]).toLocaleString(undefined,{maximumFractionDigits:4})}<small>{unit}</small></dd></div>)}</dl>
      {!!track.audio_feature_provenance?.notes?.length && <details><summary>Analysis provenance notes</summary><ul>{track.audio_feature_provenance.notes.map((note,index)=><li key={index}>{note}</li>)}</ul></details>}
    </>}
  </section>;
}
function AlgorithmCatalog() {
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("all");
  const categories=[...new Set(algorithms.map(item=>item.category))];
  const matches=useMemo(()=>algorithms.filter(item=>(category==="all"||item.category===category)&&JSON.stringify(item).toLowerCase().includes(query.trim().toLowerCase())),[query,category]);
  return <section className="learn-card" aria-labelledby="algorithm-catalog-heading"><p className="eyebrow">Complete pinned Python registry</p><h2 id="algorithm-catalog-heading">{algorithms.length} Essentia algorithms</h2><p>{catalog.scope} Generated {catalog.generated}. Each entry links to official documentation with descriptions, examples, parameter defaults, and references. The online documentation may track a newer development build.</p>
    <div className="learn-filters"><label>Search algorithms or parameters<input aria-label="Search Essentia algorithms" placeholder="Try MFCC, pitch, Tensorflow, frameSize…" value={query} onChange={event=>setQuery(event.target.value)}/></label><label>Category<select aria-label="Essentia algorithm category" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All {categories.length} categories</option>{categories.map(value=><option key={value}>{value}</option>)}</select></label></div>
    <p role="status" className="learn-note">{matches.length} of {algorithms.length} algorithms</p>
    <div className="learn-algorithms">{matches.map(item=><details key={item.name}><summary><strong>{item.name}</strong><span>{item.category} · {item.modes.join(" + ")}</span></summary><p className="learn-note">Package API reference. This algorithm is not an individually runnable Flowset demo.</p>{Object.entries(item.interfaces).map(([mode,api])=>api&&<div className="learn-algorithm-api" key={mode}><a {...external} href={`https://essentia.upf.edu/reference/${mode==="standard"?"std":"streaming"}_${item.name}.html`}>{mode} documentation ↗</a>{(["inputs","outputs","parameters"] as const).map(kind=><p key={kind}><strong>{kind}: </strong>{api[kind].length ? api[kind].map(value=>`${value.name} (${value.type})`).join(", "):"none"}</p>)}</div>)}</details>)}</div>
    {matches.length===0&&<p>No algorithms match. Try another name or reset the category.</p>}
    <p className="learn-note">Beyond this registry: <a {...external} href="https://essentia.upf.edu/models.html">all pretrained model families and checkpoint examples ↗</a> · <a {...external} href="https://essentia.upf.edu/algorithms_reference.html">current online algorithm index ↗</a>. Neither list implies those models are installed.</p>
  </section>;
}
export function Learning({tracks,audioPaths,onOpenBuilder,onOpenLab}:Props) {
  const [selected,setSelected]=useState<LearningPackageId>("clap");
  const [query,setQuery]=useState("");
  const [scope,setScope]=useState<FeatureScope|"all">("all");
  const pkg=learningPackages.find(item=>item.id===selected)!;
  const features=pkg.features.filter(item=>(scope==="all"||item.scope===scope)&&`${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="learning-page">
    <section className="learn-intro"><p className="eyebrow">Flowset learning studio</p><h1>Understand what you hear.</h1><p>Four toolkits, four ways into your music. Learn what each one does, explore its complete documented surface, and try a small experiment before using it to organize a library.</p><p className="learn-note">Scope: the four music-analysis packages used by Flowset, not every software dependency. Package versions are pinned below. Upstream tools, Flowset workflows, and fictional teaching demos are labeled separately.</p></section>
    <nav className="learn-package-nav" aria-label="Learning packages">{learningPackages.map(item=><button type="button" key={item.id} aria-label={item.name} aria-pressed={selected===item.id} onClick={()=>{setSelected(item.id);setQuery("");setScope("all");}}><strong>{item.name}</strong><span>{item.subtitle}</span></button>)}</nav>
    <section className="learn-guide" aria-labelledby="package-heading"><div className="learn-guide-main"><p className="eyebrow">{pkg.version}</p><h2 id="package-heading">{pkg.question}</h2><p>{pkg.explanation}</p><ol className="learn-pipeline" aria-label={`${pkg.name} processing steps`}>{pkg.pipeline.map((step,index)=><li key={step}><span>{index+1}</span>{step}</li>)}</ol><dl className="learn-io"><div><dt>Input</dt><dd>{pkg.input}</dd></div><div><dt>Output</dt><dd>{pkg.output}</dd></div></dl><p className="learn-caveat">{pkg.limitation}</p></div>
    <aside className="learn-reading" aria-label={`${pkg.name} reading list`}><p className="eyebrow">Read the originals</p><h3>Documentation & research</h3>{pkg.links.map(link=><a key={link.url} {...external} href={link.url}>{link.label} ↗</a>)}<p className="learn-note">Guides are original summaries, not copied READMEs. Code and model weights can have different licenses. Links open official sources in a new tab.</p></aside></section>
    <section className="learn-card" aria-labelledby="feature-inventory-heading"><div className="learn-section-heading"><div><p className="eyebrow">Capabilities and boundaries</p><h2 id="feature-inventory-heading">{pkg.name} feature inventory</h2></div><span className="learn-note">{features.length} / {pkg.features.length} capabilities</span></div><p className="learn-note">Inventory covers documented music-facing APIs and workflows for the version above. Generic inherited PyTorch / Transformers methods and internal helpers are outside this scope; full source APIs are linked above. Essentia’s individual algorithms are indexed below.</p>
    <div className="learn-filters"><label>Find a feature<input aria-label="Find a package feature" value={query} placeholder="Search this package…" onChange={event=>setQuery(event.target.value)}/></label><label>Availability<select aria-label="Feature availability" value={scope} onChange={event=>setScope(event.target.value as FeatureScope|"all")}><option value="all">All capabilities</option>{(["In Flowset","Upstream only","Flowset workflow"] as const).map(value=><option key={value}>{value}</option>)}</select></label></div>
    <div className="learn-features">{features.map(item=><article key={item.name}><span className={`learn-scope ${item.scope==="Upstream only"?"upstream":""}`}>{item.scope}</span><h3>{item.name}</h3><p>{item.detail}</p></article>)}</div>{features.length===0&&<p>No matching features in this scope.</p>}</section>
    {selected==="essentia"?<SignalDemo/>:<SimilarityDemo key={selected} reference={selected==="mert"}/>}
    <section className="learn-exercise" aria-labelledby="exercise-heading"><div><p className="eyebrow">Try it on your music</p><h2 id="exercise-heading">A guided {pkg.name} experiment</h2><ol>{pkg.exercise.map(step=><li key={step}>{step}</li>)}</ol><p className="learn-note">{tracks.length} tracks currently selected. Opening a workspace starts no inference and changes no playlist. Use its explicit run controls; runtime availability and batch limits are shown there.</p></div><div className="learn-actions"><button type="button" onClick={selected==="essentia"?onOpenBuilder:onOpenLab}>Open {selected==="essentia"?"Playlist Builder":"Semantic Lab"} →</button><button type="button" className="secondary" onClick={onOpenBuilder}>Choose local source tracks</button></div></section>
    {selected==="essentia"&&<><MeasurementDemo tracks={tracks} audioPaths={audioPaths}/><AlgorithmCatalog/></>}
    <section className="learn-card"><p className="eyebrow">What the models do not decide</p><h2>From a model output to a playlist</h2><p>Flowset supplies the organization steps: select sources → split into basis playlists → subgroup into contiguous sections → sort within each section. PCA maps, clustering, prompt contrasts, and saved recipes are application workflows. A model provides evidence; your listening decides whether songs belong together.</p><p className="learn-note">Similarity vectors, mood estimates, and measured tempo answer different questions. Check provenance and missing values, inspect complete outputs, and audition transitions before export.</p></section>
  </div>;
}
