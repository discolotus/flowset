# App icon sources

- `source/flowset-master.png` is the exact Flowset icon selected in the coordinating design task.
  The user-supplied source is `/Users/tleo/Downloads/Generated image 1.png`; it is byte-for-byte
  identical to the coordinating design asset at
  `/Users/tleo/.codex/generated_images/019fcafc-a85c-73b3-8a53-53d8b107624d/exec-ba8e7b31-ac6a-41f7-9b75-4d94ec7098c4.png`
  with SHA-256 `60eed5fe3c507933dec5ee16877c438a45a59f7784b158bd11521278720832f9`.
- `alternatives/sequence-liquid-master.png` preserves the previous Sequence liquid-glass icon.

Regenerate the native icon set from the current master with:

```bash
npm run tauri -- icon src-tauri/icons/source/flowset-master.png
```

The generated PNG, ICNS, ICO, iOS, Android, and Windows assets under this directory are committed
so release builds do not depend on an image-generation step.
