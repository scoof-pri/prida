# PRIDA 0.35.1 — scene gate asset bootstrap

Fixes the observed Render failure on commit 5aa6aa0: Model failed to load: decor-bookcase.
The CPU Three.js scene test used Scenery before loading its model dependencies.

The installer now copies existing public/models, textures and icons into the staged tree.
The scene gate reads and validates the real local GLBs, parses their mesh geometry with
the project's pinned GLTFLoader and registers every required model before Scenery construction.
Missing or malformed files still fail the build. No furniture is removed and no placeholder
models are substituted. Browser model/texture loading is unchanged.

This CPU test intentionally omits image decoding and GPU shading, as documented in its
helper; this is not an end-to-end browser or texture-rendering test.
No new tank, weapon, map, account, or ad behavior is added in this hotfix.
