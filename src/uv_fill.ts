import { track } from "./cleanup";

interface UVRegion {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface FillArea {
	rect: number[];
	uvFactorX: number;
	uvFactorY: number;
	w: number;
	h: number;
}

// Adds a "UV" fill mode that fills the UV region of any face clicked on the texture
export function setupUVFill() {
	const fillModeSelect = BarItems.fill_mode as BarSelect<string>;
	fillModeSelect.options['uv'] = { name: 'UV' };

	const originalUseFilltool = Painter.useFilltool;

	Painter.useFilltool = function(
		texture: Texture,
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		area: FillArea
	) {
		if (fillModeSelect.get() !== 'uv') {
			return originalUseFilltool.call(Painter, texture, ctx, x, y, area);
		}
		uvRegionFill(texture, ctx, x, y, area);
	};

	track({
		delete() {
			Painter.useFilltool = originalUseFilltool;
			delete fillModeSelect.options['uv'];
		}
	});
}

// Finds the face UV region at click point and fills it with solid color
function uvRegionFill(texture: Texture, ctx: CanvasRenderingContext2D, clickX: number, clickY: number, area: FillArea) {
	const region = findFaceAtPoint(texture, clickX, clickY, area.uvFactorX, area.uvFactorY);
	if (region) {
		fillRegion(ctx, region);
	}
}

// Returns the UV region of the face containing the given point
function findFaceAtPoint(texture: Texture, x: number, y: number, uvFactorX: number, uvFactorY: number): UVRegion | null {
	const animOffset = texture.display_height * texture.currentFrame;

	for (const cube of Cube.all) {
		for (const faceKey in cube.faces) {
			const face = cube.faces[faceKey as CubeFaceDirection];
			const faceTexture = face.getTexture();
			if (!faceTexture || (Painter.getTextureToEdit(faceTexture) as Texture) !== texture) continue;

			const uv = face.uv;
			if (!uv) continue;

			const minX = Math.floor(Math.min(uv[0], uv[2]) * uvFactorX);
			const maxX = Math.ceil(Math.max(uv[0], uv[2]) * uvFactorX);
			const minY = Math.floor(Math.min(uv[1], uv[3]) * uvFactorY) + animOffset;
			const maxY = Math.ceil(Math.max(uv[1], uv[3]) * uvFactorY) + animOffset;

			if (x >= minX && x < maxX && y >= minY && y < maxY) {
				return { minX, minY, maxX, maxY };
			}
		}
	}

	for (const mesh of Mesh.all) {
		for (const faceKey in mesh.faces) {
			const face = mesh.faces[faceKey];
			const faceTexture = face.getTexture();
			if (!faceTexture || (Painter.getTextureToEdit(faceTexture) as Texture) !== texture) continue;
			if (face.vertices.length < 3) continue;

			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const vkey in face.uv) {
				const uvCoord = face.uv[vkey];
				minX = Math.min(minX, uvCoord[0] * uvFactorX);
				maxX = Math.max(maxX, uvCoord[0] * uvFactorX);
				minY = Math.min(minY, uvCoord[1] * uvFactorY);
				maxY = Math.max(maxY, uvCoord[1] * uvFactorY);
			}

			minX = Math.floor(minX);
			minY = Math.floor(minY) + animOffset;
			maxX = Math.ceil(maxX);
			maxY = Math.ceil(maxY) + animOffset;

			if (x >= minX && x < maxX && y >= minY && y < maxY) {
				return { minX, minY, maxX, maxY };
			}
		}
	}

	return null;
}

// Fills a rectangular region with the current paint color
function fillRegion(ctx: CanvasRenderingContext2D, region: UVRegion) {
	const opacity = (BarItems.slider_brush_opacity as BarSlider).get() / 255;
	const eraseMode = (Painter as any).erase_mode as boolean;
	const lockAlpha = (Painter as any).lock_alpha as boolean;

	ctx.save();

	if (eraseMode) {
		ctx.globalAlpha = opacity;
		ctx.fillStyle = 'white';
		ctx.globalCompositeOperation = 'destination-out';
	} else {
		ctx.fillStyle = tinycolor(ColorPanel.get()).setAlpha(opacity).toRgbString();
		ctx.globalCompositeOperation = (Painter as any).getBlendModeCompositeOperation() as GlobalCompositeOperation;
		if (lockAlpha) {
			ctx.globalCompositeOperation = 'source-atop';
		}
	}

	ctx.fillRect(region.minX, region.minY, region.maxX - region.minX, region.maxY - region.minY);
	ctx.restore();
}
