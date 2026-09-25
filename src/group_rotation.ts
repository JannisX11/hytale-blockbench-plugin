//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

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

declare global {
	class TransformerModule {
		constructor(id: string, options: TransformerModuleOptions)
		id: string
		priority: number
		previous_value: number | null
		initial_value: number | null
		has_changed: boolean
		delete(): void
		static modules: Record<string, TransformerModule>
		static readonly active: TransformerModule | undefined
	}
	/** Returns 0/1 (global/bone root), 2 (local), 3 (normal), or the parent node for bone space */
	function getEditTransformSpace(): number | OutlinerNode | undefined
	interface UndoSystem {
		cancelEdit(revert_changes?: boolean): void
	}
	interface NumSlider {
		onBefore?(): void
		onAfter?(difference?: number): void
	}
}

/** Outliner nodes that carry a transform */
type TransformElement = OutlinerElement & { origin: ArrayVector3, rotation?: ArrayVector3 };
type TransformNode = Group | TransformElement;
function isTransformNode(node: OutlinerNode): node is TransformNode {
	return node instanceof Group || (node instanceof OutlinerElement && 'origin' in node);
}

let rotationAffectsChildren = true;

export function setupGroupRotation() {

	let toggle = new Toggle('hytale_rotation_affects_children', {
		name: 'Rotation Affects Children',
		description: 'When enabled, children follow the rotation of the parent group. When disabled, only the group rotates while children stay in place.',
		icon: 'link',
		category: 'edit',
		condition: {
			formats: FORMAT_IDS,
			modes: ['edit'],
			method: () => {
				let group = Group.first_selected;
				return !!(group && group.children.length > 0);
			}
		},
		default: true,
		onChange(value: boolean) {
			rotationAffectsChildren = value;
			toggle.setIcon(value ? 'link' : 'link_off');
		}
	});

	let rsItem = BarItems.rotation_space;
	if (rsItem) {
		for (let toolbar of Object.values(Toolbars)) {
			let index = toolbar.children.indexOf(rsItem);
			if (index !== -1) {
				toolbar.add(toggle, index + 1);
				break;
			}
		}
	}
	Toolbars.element_rotation?.add(toggle);

	type ChildSnapshot = { origin: number[], rotation?: number[], from?: number[], to?: number[] };
	type DescendantSnapshot = { origin: number[], from?: number[], to?: number[] };
	type GroupSnapshot = {
		initialQuat: THREE.Quaternion,
		parentWorldQuat: THREE.Quaternion,
		spaceMode: 'local' | 'bone' | 'global',
		children: Map<string, ChildSnapshot>,
		descendants: Map<string, DescendantSnapshot>
	};
	let rotateSnapshots: Map<string, GroupSnapshot> | null = null;
	let cumulativeAngle = 0;

	/** Selected groups whose parent isn't also selected */
	function getTopSelectedGroups() {
		return Group.multi_selected.filter(g => !(g.parent instanceof Group && g.parent.selected));
	}

	function canCounterRotate() {
		if (!isHytaleFormat() || Modes.id !== 'edit' || !Format.bone_rig || rotationAffectsChildren) return false;
		let group = Group.first_selected;
		return !!(group && group.children.length > 0);
	}

	function quatFromRotation(rotation: number[]) {
		return new THREE.Quaternion().setFromEuler(new THREE.Euler(
			Math.degToRad(rotation[0]), Math.degToRad(rotation[1]), Math.degToRad(rotation[2]), 'ZYX'
		));
	}

	function applyCounterRotation(groups: Group[], axisNumber: number, totalAngle: number) {
		let elementsToUpdate: OutlinerElement[] = [];
		let axis = new THREE.Vector3();
		axis.setComponent(axisNumber, 1);
		let delta = new THREE.Quaternion().setFromAxisAngle(axis, Math.degToRad(totalAngle));

		for (let group of groups) {
			let snap = rotateSnapshots?.get(group.uuid);
			if (!snap) continue;

			let newQuat: THREE.Quaternion;
			if (snap.spaceMode === 'local') {
				newQuat = snap.initialQuat.clone().multiply(delta);
			} else if (snap.spaceMode === 'global') {
				let p = snap.parentWorldQuat;
				let localDelta = new THREE.Quaternion()
					.multiplyQuaternions(p.clone().invert(), delta)
					.multiply(p);
				newQuat = new THREE.Quaternion().multiplyQuaternions(localDelta, snap.initialQuat);
			} else {
				newQuat = new THREE.Quaternion().multiplyQuaternions(delta, snap.initialQuat);
			}

			let e = new THREE.Euler().setFromQuaternion(newQuat, 'ZYX');
			group.rotation[0] = Math.radToDeg(e.x);
			group.rotation[1] = Math.radToDeg(e.y);
			group.rotation[2] = Math.radToDeg(e.z);

			counterRotateChildren(group, snap, elementsToUpdate);
		}

		return elementsToUpdate;
	}

	/** Restores children's world transform after the group's rotation changed */
	function counterRotateChildren(group: Group, snap: GroupSnapshot, elementsToUpdate: OutlinerElement[]) {
		let dQ = quatFromRotation(group.rotation).invert().multiply(snap.initialQuat);
		let groupOrigin = new THREE.Vector3(...group.origin);

		for (let child of group.children.filter(isTransformNode)) {
			let cs = snap.children.get(child.uuid);
			if (!cs) continue;

			let offset = new THREE.Vector3(...cs.origin).sub(groupOrigin).applyQuaternion(dQ);
			let newOrigin = groupOrigin.clone().add(offset);
			child.origin[0] = newOrigin.x;
			child.origin[1] = newOrigin.y;
			child.origin[2] = newOrigin.z;

			if (cs.rotation) {
				let cq = quatFromRotation(cs.rotation).premultiply(dQ);
				let ce = new THREE.Euler().setFromQuaternion(cq, 'ZYX');
				child.rotation[0] = Math.radToDeg(ce.x);
				child.rotation[1] = Math.radToDeg(ce.y);
				child.rotation[2] = Math.radToDeg(ce.z);
			}

			let od = [newOrigin.x - cs.origin[0], newOrigin.y - cs.origin[1], newOrigin.z - cs.origin[2]];

			if (child instanceof Cube && cs.from && cs.to) {
				for (let i = 0; i < 3; i++) {
					child.from[i] = cs.from[i] + od[i];
					child.to[i] = cs.to[i] + od[i];
				}
			}

			if (child instanceof Group) {
				child.forEachChild((desc: OutlinerNode) => {
					let ds = snap.descendants.get(desc.uuid);
					if (!ds || !isTransformNode(desc)) return;
					for (let i = 0; i < 3; i++) desc.origin[i] = ds.origin[i] + od[i];
					if (desc instanceof Cube && ds.from && ds.to) {
						for (let i = 0; i < 3; i++) {
							desc.from[i] = ds.from[i] + od[i];
							desc.to[i] = ds.to[i] + od[i];
						}
					}
				});
			}

			if (child instanceof OutlinerElement) elementsToUpdate.push(child);
			if (child instanceof Group) {
				child.forEachChild((el: OutlinerNode) => {
					if (el instanceof OutlinerElement) elementsToUpdate.push(el);
				}, OutlinerElement);
			}
		}
	}

	function refreshView(elements: OutlinerElement[]) {
		Canvas.updateAllBones();
		Canvas.updateView({
			elements,
			element_aspects: {geometry: true, transform: true},
		});
	}

	/** Snapshots groups and their children, and starts the undo edit */
	function snapshotAndInitEdit(groups: Group[], spaceMode: GroupSnapshot['spaceMode']) {
		rotateSnapshots = new Map();
		let elements: OutlinerElement[] = [];
		let allGroups: Group[] = [...groups];

		for (let group of groups) {
			let childSnaps = new Map<string, ChildSnapshot>();
			let descendantSnaps = new Map<string, DescendantSnapshot>();

			for (let child of group.children.filter(isTransformNode)) {
				childSnaps.set(child.uuid, {
					origin: [...child.origin],
					rotation: child.rotation ? [...child.rotation] : undefined,
					from: child instanceof Cube ? [...child.from] : undefined,
					to: child instanceof Cube ? [...child.to] : undefined
				});

				if (child instanceof OutlinerElement) elements.push(child);
				if (child instanceof Group) {
					allGroups.push(child);
					child.forEachChild((el: OutlinerNode) => {
						if (!isTransformNode(el)) return;
						if (el instanceof OutlinerElement) elements.push(el);
						if (el instanceof Group) allGroups.push(el);
						descendantSnaps.set(el.uuid, {
							origin: [...el.origin],
							from: el instanceof Cube ? [...el.from] : undefined,
							to: el instanceof Cube ? [...el.to] : undefined
						});
					});
				}
			}

			let parentWorldQuat = new THREE.Quaternion();
			if (group.parent instanceof Group && group.parent.mesh) {
				parentWorldQuat.setFromRotationMatrix(
					new THREE.Matrix4().extractRotation(group.parent.mesh.matrixWorld)
				);
			}

			rotateSnapshots.set(group.uuid, {
				initialQuat: quatFromRotation(group.rotation),
				parentWorldQuat,
				spaceMode,
				children: childSnaps,
				descendants: descendantSnaps
			});
		}

		Undo.initEdit({elements, groups: allGroups});
	}

	let module = new TransformerModule('hytale_group_rotate', {
		priority: 2,
		condition: () => Toolbox.selected?.id === 'rotate_tool' && canCounterRotate(),

		updateGizmo() {
			if (!Transformer.visible) return;
			let group = Group.first_selected;
			if (!group || !group.mesh) {
				Transformer.detach();
				return;
			}
			Transformer.rotation_object = group;
			group.mesh.getWorldPosition(Transformer.position);
			Transformer.position.sub(Canvas.scene.position);

			let space = getEditTransformSpace();
			if (typeof space === 'number' && space >= 2) {
				Transformer.rotation_ref = group.mesh;
			} else if (space instanceof OutlinerNode && isTransformNode(space) && space.getTypeBehavior('parent')) {
				Transformer.rotation_ref = space.mesh;
			} else {
				Transformer.rotation_ref = null;
			}
		},

		calculateOffset(context) {
			let snap = getRotationInterval(context.event);
			let angle = context.angle ?? 0;
			angle = Math.round(angle / snap) * snap;
			if (Math.abs(angle) > 300) angle = angle > 0 ? -snap : snap;
			return angle;
		},

		onStart() {
			cumulativeAngle = 0;
			let groups = getTopSelectedGroups();
			let space = getEditTransformSpace();

			let spaceMode: 'local' | 'bone' | 'global';
			if (typeof space === 'number' && space >= 2) spaceMode = 'local';
			else if (space instanceof OutlinerNode) spaceMode = 'bone';
			else spaceMode = 'global';

			snapshotAndInitEdit(groups, spaceMode);
		},

		onMove(context) {
			let { axis_number, value } = context;
			let difference = value - (this.previous_value ?? value);
			if (difference > 180) difference -= 360;
			if (difference < -180) difference += 360;
			cumulativeAngle += difference;

			let groups = getTopSelectedGroups();
			let elementsToUpdate = applyCounterRotation(groups, axis_number, cumulativeAngle);

			Blockbench.setCursorTooltip(trimFloatNumber(cumulativeAngle));

			refreshView(elementsToUpdate);
			updateSelection();
		},

		onEnd(context) {
			rotateSnapshots = null;
			if (context.has_changed && context.keep_changes) {
				Undo.finishEdit('Rotate group');
			}
			updateSelection();
		},

		onCancel() {
			rotateSnapshots = null;
			Undo.cancelEdit(true);
		}
	});

	// Element panel rotation sliders: let the native change run, then counter-rotate children
	let sliders = ['slider_rotation_x', 'slider_rotation_y', 'slider_rotation_z'].map(id => BarItems[id] as NumSlider);
	let originals = sliders.map(({onBefore, change, onAfter}) => ({onBefore, change, onAfter}));
	sliders.forEach((slider, i) => {
		let original = originals[i];
		slider.onBefore = function() {
			if (!canCounterRotate()) return original.onBefore?.call(this);
			snapshotAndInitEdit(getTopSelectedGroups(), 'local');
		};
		slider.change = function(modify) {
			original.change.call(this, modify);
			if (!rotateSnapshots) return;
			let elementsToUpdate: OutlinerElement[] = [];
			for (let group of getTopSelectedGroups()) {
				let snap = rotateSnapshots.get(group.uuid);
				if (snap) counterRotateChildren(group, snap, elementsToUpdate);
			}
			refreshView(elementsToUpdate);
		};
		slider.onAfter = function(difference) {
			original.onAfter?.call(this, difference);
			rotateSnapshots = null;
		};
	});

	track(toggle, {
		delete() {
			module.delete();
			sliders.forEach((slider, i) => Object.assign(slider, originals[i]));
		}
	});
}
