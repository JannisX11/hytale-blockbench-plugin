//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

interface ChildSnapshot {
	origin?: ArrayVector3;
	from?: ArrayVector3;
	to?: ArrayVector3;
}

interface PivotSnapshot {
	origins: Map<any, ArrayVector3>;
	children: Map<any, ChildSnapshot>;
}

let snapshot: PivotSnapshot | null = null;

function takeSnapshot(): PivotSnapshot {
	let result: PivotSnapshot = { origins: new Map(), children: new Map() };
	let pivotObjects = getPivotObjects();
	if (!pivotObjects) return result;

	for (let obj of pivotObjects) {
		result.origins.set(obj, (obj as any).origin.slice());
	}

	let children = pivotObjects[0] instanceof Group
		? (() => { let list: OutlinerNode[] = []; for (let group of pivotObjects as Group[]) group.forEachChild(child => list.push(child)); return list; })()
		: pivotObjects;

	for (let child of children) {
		let element = child as any;
		result.children.set(child, {
			origin: element.origin?.slice(),
			from: element.from?.slice(),
			to: element.to?.slice(),
		});
	}
	return result;
}

// Replicates the rotation-aware shift from Group/Cube.transferOrigin
function computeTransferShift(mesh: any, oldOrigin: ArrayVector3, newOrigin: ArrayVector3): [number, number, number] {
	let quaternion = new THREE.Quaternion().copy(mesh.quaternion);
	let shift = new THREE.Vector3(oldOrigin[0] - newOrigin[0], oldOrigin[1] - newOrigin[1], oldOrigin[2] - newOrigin[2]);
	let rotatedShift = new THREE.Vector3().copy(shift);
	rotatedShift.applyQuaternion(quaternion);
	shift.sub(rotatedShift).applyQuaternion(quaternion.invert());
	return [shift.x, shift.y, shift.z];
}

function restoreWithShift(target: number[] | undefined, saved: ArrayVector3 | undefined, dx: number, dy: number, dz: number) {
	if (!target || !saved) return;
	target[0] = saved[0] + dx;
	target[1] = saved[1] + dy;
	target[2] = saved[2] + dz;
}

function compensate(snap: PivotSnapshot, locked: boolean) {
	let pivotObjects = getPivotObjects();
	if (!pivotObjects) return;

	let isGroup = pivotObjects[0] instanceof Group;

	for (let obj of pivotObjects) {
		let element = obj as any;
		let oldOrigin = snap.origins.get(obj);
		if (!oldOrigin || !element.mesh) continue;

		let [dx, dy, dz] = locked
			? [element.origin[0] - oldOrigin[0], element.origin[1] - oldOrigin[1], element.origin[2] - oldOrigin[2]]
			: computeTransferShift(element.mesh, oldOrigin, element.origin);
		if (!dx && !dy && !dz) continue;

		if (isGroup) {
			(obj as Group).forEachChild(child => {
				let saved = snap.children.get(child);
				if (!saved) return;
				let childElement = child as any;
				restoreWithShift(childElement.origin, saved.origin, dx, dy, dz);
				restoreWithShift(childElement.from, saved.from, dx, dy, dz);
				restoreWithShift(childElement.to, saved.to, dx, dy, dz);
			});
		} else {
			let saved = snap.children.get(obj);
			if (!saved) continue;
			restoreWithShift(element.from, saved.from, dx, dy, dz);
			restoreWithShift(element.to, saved.to, dx, dy, dz);
		}
	}

	let childElements: OutlinerElement[] = [];
	if (isGroup) {
		for (let group of pivotObjects as Group[]) {
			group.forEachChild(child => childElements.safePush(child), OutlinerElement);
		}
	}
	Canvas.updateView({
		groups: Group.all,
		group_aspects: { transform: true },
		elements: childElements.length ? childElements : pivotObjects as OutlinerElement[],
		element_aspects: { transform: true, geometry: true },
		selection: true,
	});
}

export function setupPivotCoordinates() {
	let toggle = new Toggle('hytale_lock_pivot_geometry', {
		name: 'Lock Geometry to Pivot',
		description: 'When locked, geometry follows pivot changes. When unlocked, pivot moves freely without affecting geometry.',
		icon: 'fas.fa-lock',
		category: 'transform',
		condition: () => isHytaleFormat() && Modes.edit && getPivotObjects() && (Group.first_selected || Outliner.selected.length > Locator.selected.length),
		default: true,
		save_on_restart: true,
	} as any);
	track(toggle);
	Toolbars.element_origin.add(toggle);
	track({ delete() { Toolbars.element_origin.remove(toggle); } });

	(['x', 'y', 'z'] as const).forEach(axis => {
		type SliderWithHooks = NumSlider & { onBefore?: () => void; onAfter?: (d?: number) => void };
		let slider = BarItems[`slider_origin_${axis}`] as SliderWithHooks;
		let originalChange = slider.change;
		let originalOnBefore = slider.onBefore;
		let originalOnAfter = slider.onAfter;

		slider.onBefore = function () {
			if (!isHytaleFormat()) { snapshot = null; return originalOnBefore?.call(this); }
			snapshot = takeSnapshot();
			let elements: OutlinerElement[] = [...selected];
			let groups: Group[] = [...Group.multi_selected];
			for (let group of Group.multi_selected) {
				group.forEachChild(child => {
					if (child instanceof Group) groups.safePush(child);
					else elements.safePush(child);
				});
			}
			Undo.initEdit({ elements, groups });
		};

		slider.change = function (modify: (n: number) => number) {
			originalChange?.call(this, modify);
			if (isHytaleFormat() && snapshot) compensate(snapshot, toggle.value);
		};

		slider.onAfter = function (difference?: number) {
			if (!isHytaleFormat()) return originalOnAfter?.call(this, difference);
			snapshot = null;
			Undo.finishEdit('Change pivot point');
		};

		track({ delete() { slider.change = originalChange; slider.onBefore = originalOnBefore; slider.onAfter = originalOnAfter; } });
	});
}
