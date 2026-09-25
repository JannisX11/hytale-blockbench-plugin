
declare module "*.png" {
	const value: string;
	export default value;
}
declare module "*.json" {
	const val: any;
	export default val;
}

// Missing from blockbench-types; mirrors js/modeling/transform/transform_modules.ts
interface TransformContext {
	event: Event
}
interface TransformContextMove extends TransformContext {
	point: THREE.Vector3
	axis: 'x' | 'y' | 'z'
	axis_number: 0 | 1 | 2
	rotate_normal: THREE.Vector3
	direction: 1 | -1
	angle?: number
	value?: number
}
interface TransformContextEnd extends TransformContext {
	has_changed: boolean
	keep_changes: boolean
}
interface TransformerModuleOptions {
	priority: number
	condition: ConditionResolvable
	use_condition?: ConditionResolvable
	updateGizmo: (this: TransformerModule) => void | boolean
	onPointerDown?: (this: TransformerModule, context: TransformContext) => void
	calculateOffset: (this: TransformerModule, context: TransformContextMove) => number
	onStart?: (this: TransformerModule, context: TransformContextMove) => void
	onMove?: (this: TransformerModule, context: TransformContextMove) => void
	onEnd?: (this: TransformerModule, context: TransformContextEnd) => void
	onCancel?: (this: TransformerModule, context: TransformContextEnd) => void
}

declare class TransformerModule {
	constructor(id: string, options: TransformerModuleOptions)
	id: string
	priority: number
	previous_value: number | null
	initial_value: number | null
	has_changed: boolean
	dispatchPointerDown(context: TransformContext): void
	dispatchMove(context: TransformContextMove): void
	dispatchEnd(context: TransformContextEnd): void
	dispatchCancel(context: TransformContextEnd): void
	delete(): void
	static modules: Record<string, TransformerModule>
	static readonly active: TransformerModule | undefined
}
/** Returns 0/1 (global/bone root), 2 (local), 3 (normal), or the parent node for bone space */
declare function getEditTransformSpace(): number | OutlinerNode | undefined

// Outdated or incomplete signatures in blockbench-types
interface UndoSystem {
	cancelEdit(revert_changes?: boolean): void
}
interface NumSlider {
	onBefore?(): void
	onAfter?(difference?: number): void
}
interface Tool {
	transformerMode?: 'translate' | 'scale' | 'rotate' | 'stretch' | 'hidden' | ''
}

/** Blockbench's rotate gizmo internals; mirrors THREE.TransformGizmoRotate in transform_gizmo.js */
interface RotateGizmo extends THREE.Object3D {
	handles: THREE.Object3D
	activePlane: THREE.Object3D
	handleGizmos: Record<string, unknown>
}
