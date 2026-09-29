// What the loading screen says when 3D cannot start. The game needs WebGL 2; browsers switch it off after a
// graphics driver crash (until the browser is restarted), when hardware acceleration is off, or on old versions.

// Which WebGL versions this browser hands out right now, probed on throwaway canvases that are released at once.
export function glSupport(doc = globalThis.document) {
  const test = (kind) => {
    try {
      const gl = doc.createElement('canvas').getContext(kind);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    } catch {
      return false;
    }
  };
  return { webgl2: test('webgl2'), webgl: test('webgl') };
}

// Title and explanation for a failed start. `error.webgl` marks a refused graphics context (render.js).
export function glAdvice(support, error) {
  if (!error?.webgl)
    return {
      title: 'PRIDA could not start.',
      text: 'Something went wrong while building the world. Try again; if it happens every time, restart the browser.',
      steps: false,
    };
  if (support.webgl2)
    return {
      title: '3D did not start this time.',
      text: 'The browser refused the game a graphics context for a moment, but 3D is available now. Press TRY AGAIN.',
      steps: false,
    };
  if (support.webgl)
    return {
      title: 'This browser is too old for PRIDA.',
      text: 'It only offers WebGL 1, and the game needs WebGL 2. Update the browser (Safari 15 or newer, or a current Chrome, Edge or Firefox), or try another one.',
      steps: false,
    };
  return {
    title: '3D graphics are switched off in this browser.',
    text: 'This is not a problem with your save or the game files. After the graphics driver crashes, a browser keeps 3D off until it is restarted; it is also off when hardware acceleration is disabled.',
    steps: true,
  };
}
