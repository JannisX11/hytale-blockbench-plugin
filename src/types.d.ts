
declare module "*.png" {
	const value: string;
	export default value;
}
declare module "*.json" {
	const val: any;
	export default val;
}

/** Returns 0/1 (global/bone root), 2 (local), 3 (normal), or the parent node for bone space */
declare function getEditTransformSpace(): number | OutlinerNode | undefined


interface NumSlider extends Widget {
	onBefore?(): void
	onAfter?(difference?: number): void
	change: (modfy: any) => void
}


/** Blockbench's rotate gizmo internals; mirrors THREE.TransformGizmoRotate in transform_gizmo.js */
interface RotateGizmo extends THREE.Object3D {
	handles: THREE.Object3D
	activePlane: THREE.Object3D
	handleGizmos: Record<string, unknown>
}
