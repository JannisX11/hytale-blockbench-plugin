import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

export function setupEraserLockAlpha() {
	const painter = Painter as { lock_alpha: boolean };

	function withoutLockAlpha<T>(callback: () => T): T {
		const lock_alpha = painter.lock_alpha;
		painter.lock_alpha = false;
		try {
			return callback();
		} finally {
			painter.lock_alpha = lock_alpha;
		}
	}

	// Let the eraser edit alpha while Lock Alpha is on
	const brush = (BarItems.eraser as Tool).brush;
	const originalChangePixel = brush.changePixel;
	brush.changePixel = function(...args) {
		if (!isHytaleFormat()) return originalChangePixel.apply(this, args);
		return withoutLockAlpha(() => originalChangePixel.apply(this, args));
	};

	// Keep strokes on the surface instead of passing through pixels the eraser just cleared
	const originalRaycast = Preview.prototype.raycast;
	Preview.prototype.raycast = function(...args) {
		if (!isHytaleFormat() || Toolbox.selected !== BarItems.eraser) return originalRaycast.apply(this, args);
		return withoutLockAlpha(() => originalRaycast.apply(this, args));
	};

	track({
		delete() {
			brush.changePixel = originalChangePixel;
			Preview.prototype.raycast = originalRaycast;
		}
	});
}
