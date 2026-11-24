
declare module "*.png" {
	const value: string;
	export default value;
}
declare namespace Painter {
	let startPaintTool: (texture: Texture, x: number, y: number, uvTag: any, event: PointerEvent, data?: any) => void
	let movePaintTool: (texture: Texture, x: number, y: number, event: PointerEvent, new_face?: boolean, uv?: any) => void
}
declare module "*.json" {
	const val: any;
	export default val;
}