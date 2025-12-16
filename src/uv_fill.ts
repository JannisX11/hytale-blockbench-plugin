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

// Adds "UV" fill mode: fills transparent areas or replaces flat-colored faces
export function setupUVFill() {
	const fillModeSelect = BarItems.fill_mode as BarSelect<string>;
	fillModeSelect.options['uv'] = { name: 'UV' };

	const originalUseFilltool = Painter.useFilltool;

	Painter.useFilltool = function(texture: Texture, ctx: CanvasRenderingContext2D, x: number, y: number, area: FillArea) {
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

// Main fill logic: transparent click fills transparent pixels, flat color click replaces entire face
function uvRegionFill(texture: Texture, ctx: CanvasRenderingContext2D, x: number, y: number, area: FillArea) {
	const region = findFaceRegion(texture, x, y, area.uvFactorX, area.uvFactorY);
	if (!region) return;

	const clickedAlpha = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];

	if (clickedAlpha === 0) {
		fillTransparent(ctx, region);
	} else if (isFlatColor(ctx, region)) {
		fillRegion(ctx, region);
	}
}

// Returns UV bounds of the face containing the point, or null if none found
function findFaceRegion(texture: Texture, x: number, y: number, uvFactorX: number, uvFactorY: number): UVRegion | null {
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
				const uv = face.uv[vkey];
				minX = Math.min(minX, uv[0] * uvFactorX);
				maxX = Math.max(maxX, uv[0] * uvFactorX);
				minY = Math.min(minY, uv[1] * uvFactorY);
				maxY = Math.max(maxY, uv[1] * uvFactorY);
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

function isFlatColor(ctx: CanvasRenderingContext2D, region: UVRegion): boolean {
	const width = region.maxX - region.minX;
	const height = region.maxY - region.minY;
	if (width <= 0 || height <= 0) return false;

	const data = ctx.getImageData(region.minX, region.minY, width, height).data;
	const [r, g, b, a] = [data[0], data[1], data[2], data[3]];

	for (let i = 4; i < data.length; i += 4) {
		if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) {
			return false;
		}
	}
	return true;
}

function fillRegion(ctx: CanvasRenderingContext2D, region: UVRegion) {
	const opacity = (BarItems.slider_brush_opacity as BarSlider).get() / 255;

	ctx.save();
	ctx.fillStyle = tinycolor(ColorPanel.get()).setAlpha(opacity).toRgbString();
	ctx.fillRect(region.minX, region.minY, region.maxX - region.minX, region.maxY - region.minY);
	ctx.restore();
}

function fillTransparent(ctx: CanvasRenderingContext2D, region: UVRegion) {
	const width = region.maxX - region.minX;
	const height = region.maxY - region.minY;
	if (width <= 0 || height <= 0) return;

	const imageData = ctx.getImageData(region.minX, region.minY, width, height);
	const data = imageData.data;
	const color = tinycolor(ColorPanel.get()).toRgb();
	const alpha = Math.round((BarItems.slider_brush_opacity as BarSlider).get() / 255 * 255);

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] === 0) {
			data[i] = color.r;
			data[i + 1] = color.g;
			data[i + 2] = color.b;
			data[i + 3] = alpha;
		}
	}

	ctx.putImageData(imageData, region.minX, region.minY);
}
