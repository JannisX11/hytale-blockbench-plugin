import { track } from "./cleanup";

declare global {
	function pointInPolygon(point: ArrayVector2, polygon: ArrayVector2[]): boolean
}

interface UVRegion {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface FaceHit {
	element: OutlinerElement;
	faceKey: string;
	region: UVRegion;
}

interface FillArea {
	rect: number[];
	uvFactorX: number;
	uvFactorY: number;
	w: number;
	h: number;
}

export function setupUVFill() {
	const originalUseFilltool = (Painter as any).useFilltool;

	(Painter as any).useFilltool = function(texture: Texture, ctx: CanvasRenderingContext2D, x: number, y: number, area: FillArea) {
		const fill_mode = (BarItems.fill_mode as BarSelect).get();
		const element = Painter.current.element;

		if (!element) {
			const hit = findFaceAtUV(texture, x, y, area.uvFactorX, area.uvFactorY);
			if (hit) {
				if (fill_mode === 'face' || fill_mode === 'element') {
					Painter.current.element = hit.element;
					Painter.current.face = hit.faceKey;
				} else if (fill_mode === 'color' || fill_mode === 'color_connected') {
					const r = hit.region;
					area = { ...area, rect: [r.minX, r.minY, r.maxX, r.maxY], w: r.maxX - r.minX, h: r.maxY - r.minY };
				}
			}
		}

		return originalUseFilltool.call(Painter, texture, ctx, x, y, area);
	};

	track({
		delete() {
			(Painter as any).useFilltool = originalUseFilltool;
		}
	});
}

function findFaceAtUV(texture: Texture, x: number, y: number, uvFactorX: number, uvFactorY: number): FaceHit | null {
	const animOffset = texture.display_height * texture.currentFrame;

	for (const cube of (Cube.all as any).concat(Billboard.all)) {
		for (const faceKey in cube.faces) {
			const face = cube.faces[faceKey as CubeFaceDirection];
			const faceTexture = face.getTexture();
			if (!faceTexture || ((Painter as any).getTextureToEdit(faceTexture) as Texture) !== texture) continue;

			const uv = face.uv;
			if (!uv) continue;

			const minX = Math.floor(Math.min(uv[0], uv[2]) * uvFactorX);
			const maxX = Math.ceil(Math.max(uv[0], uv[2]) * uvFactorX);
			const minY = Math.floor(Math.min(uv[1], uv[3]) * uvFactorY) + animOffset;
			const maxY = Math.ceil(Math.max(uv[1], uv[3]) * uvFactorY) + animOffset;

			if (x >= minX && x < maxX && y >= minY && y < maxY) {
				return { element: cube, faceKey, region: { minX, minY, maxX, maxY } };
			}
		}
	}

	for (const mesh of Mesh.all) {
		for (const faceKey in mesh.faces) {
			const face = mesh.faces[faceKey];
			const faceTexture = face.getTexture();
			if (!faceTexture || ((Painter as any).getTextureToEdit(faceTexture) as Texture) !== texture) continue;
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

			let polygon = face.getSortedVertices().map(vkey => face.uv[vkey]);
			if (pointInPolygon([x, y], polygon)) {
				return { element: mesh, faceKey, region: { minX, minY, maxX, maxY } };
			}
		}
	}

	return null;
}
