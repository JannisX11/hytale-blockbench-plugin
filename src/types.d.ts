// UVEditor.vue members the plugin uses; blockbench-types leaves UVEditor untyped
interface UVEditorVue {
	texture: Texture | 0 | null;
	layer: Texture['selected_layer'];
	updateTexture(): void;
	updateTextureCanvas(): void;
}

declare module "*.png" {
	const value: string;
	export default value;
}
declare module "*.json" {
	const val: any;
	export default val;
}