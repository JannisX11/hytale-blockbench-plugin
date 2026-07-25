//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

declare global {
	const TransformerModule: {
		new(id: string, options: any): any;
		modules: Record<string, any>;
		active: any;
	}
	function getEditTransformSpace(): any
	function getRotationInterval(event: Event): number
	function trimFloatNumber(number: number): string
}

let affectChildrenEnabled = true;

export function setupGroupRotation() {

	let toggle = new Toggle('hytale_affect_children', {
		name: 'Affect Children',
		description: 'When enabled, children follow the rotation of the parent group. When disabled, only the group rotates while children stay in place.',
		icon: 'link',
		category: 'edit',
		condition: {
			formats: FORMAT_IDS,
			modes: ['edit'],
			tools: ['rotate_tool'],
			method: () => {
				let group = Group.first_selected;
				return !!(group && group.children.length > 0);
			}
		},
		default: true,
		onChange(value: boolean) {
			affectChildrenEnabled = value;
			toggle.setIcon(value ? 'link' : 'link_off');
		}
	});

	let rsItem = BarItems.rotation_space;
	if (rsItem) {
		for (let toolbar of Object.values(Toolbars)) {
			let children = (toolbar as any).children;
			if (Array.isArray(children) && children.includes(rsItem)) {
				let index = children.indexOf(rsItem);
				(toolbar as any).add(toggle, index + 1);
				break;
			}
		}
	}

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

			let dQ = newQuat.clone().invert().multiply(snap.initialQuat);
			let groupOrigin = new THREE.Vector3(...group.origin);

			for (let child of group.children) {
				let cs = snap.children.get(child.uuid);
				if (!cs) continue;

				let offset = new THREE.Vector3(...cs.origin).sub(groupOrigin).applyQuaternion(dQ);
				let newOrigin = groupOrigin.clone().add(offset);
				child.origin[0] = newOrigin.x;
				child.origin[1] = newOrigin.y;
				child.origin[2] = newOrigin.z;

				if (cs.rotation) {
					let cq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
						Math.degToRad(cs.rotation[0]), Math.degToRad(cs.rotation[1]),
						Math.degToRad(cs.rotation[2]), 'ZYX'
					));
					cq.premultiply(dQ);
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
						if (!ds) return;
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

		return elementsToUpdate;
	}

	let module = new TransformerModule('hytale_group_rotate', {
		priority: 2,
		condition: () => {
			if (!isHytaleFormat() || Modes.id !== 'edit' || Toolbox.selected?.id !== 'rotate_tool') return false;
			if (!Format.bone_rig || affectChildrenEnabled) return false;
			let group = Group.first_selected;
			return !!(group && group.children.length > 0);
		},

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
			} else if (space instanceof OutlinerNode && (space as any).getTypeBehavior?.('parent')) {
				Transformer.rotation_ref = (space as any).mesh;
			} else {
				Transformer.rotation_ref = null;
			}
		},

		calculateOffset(context: any) {
			let snap = getRotationInterval(context.event);
			let angle = context.angle ?? 0;
			angle = Math.round(angle / snap) * snap;
			if (Math.abs(angle) > 300) angle = angle > 0 ? -snap : snap;
			return angle;
		},

		onStart() {
			cumulativeAngle = 0;
			let groups = Group.multi_selected.filter((g: Group) => !g.parent?.selected);
			let space = getEditTransformSpace();

			let spaceMode: 'local' | 'bone' | 'global';
			if (typeof space === 'number' && space >= 2) spaceMode = 'local';
			else if (space instanceof OutlinerNode) spaceMode = 'bone';
			else spaceMode = 'global';

			rotateSnapshots = new Map();
			let elements: OutlinerElement[] = [];
			let allGroups: Group[] = [...groups];

			for (let group of groups) {
				let childSnaps = new Map<string, ChildSnapshot>();
				let descendantSnaps = new Map<string, DescendantSnapshot>();

				for (let child of group.children) {
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
							if (el instanceof OutlinerElement) elements.push(el);
							if (el instanceof Group) allGroups.push(el as Group);
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
					initialQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(
						Math.degToRad(group.rotation[0]),
						Math.degToRad(group.rotation[1]),
						Math.degToRad(group.rotation[2]),
						'ZYX'
					)),
					parentWorldQuat,
					spaceMode,
					children: childSnaps,
					descendants: descendantSnaps
				});
			}

			Undo.initEdit({elements, groups: allGroups});
		},

		onMove(context: any) {
			let { axis_number, value } = context;
			let difference = value - ((this as any).previous_value ?? value);
			if (difference > 180) difference -= 360;
			if (difference < -180) difference += 360;
			cumulativeAngle += difference;

			let groups = Group.multi_selected.filter((g: Group) => !g.parent?.selected);
			let elementsToUpdate = applyCounterRotation(groups, axis_number, cumulativeAngle);

			Blockbench.setCursorTooltip(trimFloatNumber(cumulativeAngle));

			Canvas.updateAllBones();
			Canvas.updateView({
				elements: elementsToUpdate,
				element_aspects: {geometry: true, transform: true},
			});
			Transformer.updateSelection();
		},

		onEnd(context: any) {
			rotateSnapshots = null;
			if (context.has_changed && context.keep_changes) {
				Undo.finishEdit('Rotate group');
			}
		},

		onCancel() {
			rotateSnapshots = null;
			Undo.cancelEdit(true);
		}
	});

	track(toggle, {
		delete() {
			module.delete();
		}
	});
}
