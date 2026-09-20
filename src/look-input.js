// Keep relative pointer-lock input separate from absolute drag coordinates.
export class LookInput {
  constructor() {
    this.reset();
  }
  reset() {
    this.skipRelative = true;
    this.anchor = null;
  }
  lockChanged() {
    this.reset();
  }
  startDrag(id, x, y) {
    this.anchor = { id, x, y };
  }
  endDrag(id) {
    if (this.anchor?.id === id) this.anchor = null;
  }
  relative(dx, dy) {
    if (this.skipRelative) {
      this.skipRelative = false;
      return null;
    }
    return this.validDelta(dx, dy);
  }
  drag(id, x, y) {
    if (!this.anchor || this.anchor.id !== id) return null;
    const dx = x - this.anchor.x,
      dy = y - this.anchor.y;
    this.anchor = { id, x, y };
    return this.validDelta(dx, dy);
  }
  validDelta(dx, dy) {
    // Discard a cursor warp, never clamp it into a large unintended camera turn.
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) > 160) return null;
    return { dx, dy };
  }
}
