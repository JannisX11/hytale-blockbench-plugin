//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

declare global {
	const StateMemory: any
}

let pivotFollowEnabled = true;

/**
 * Pivot control features for Hytale formats.
 * Provides a "Pivot Follow" toggle that controls whether cube origins (pivot points)
 * follow geometry when translating, regardless of the active transform space.
 *
 * Pivot marker visual during drag:
 *   ON  → marker stays on the mesh (default parenting), follows geometry naturally
 *   OFF → marker is re-parented as a sibling at its initial position, stays frozen
 *
 * On pointerup, adjusts the actual origin data and restores the marker.
 */
export function setupPivotControl() {

	StateMemory.init('hytale_pivot_follow', 'boolean');
	pivotFollowEnabled = StateMemory.get('hytale_pivot_follow') ?? true;

	let toggle = new Toggle('hytale_pivot_follow', {
		name: 'Pivot Follow',
		description: 'When enabled, the pivot point moves along with the element when using the move tool',
		icon: pivotFollowEnabled ? 'location_searching' : 'location_disabled',
		category: 'edit',
		condition: {formats: FORMAT_IDS, modes: ['edit']},
		default: pivotFollowEnabled,
		onChange(value: boolean) {
			pivotFollowEnabled = value;
			StateMemory.set('hytale_pivot_follow', value);
			toggle.setIcon(value ? 'location_searching' : 'location_disabled');
		}
	});

	// Place toggle near the transform space selector
	let tsItem = BarItems.transform_space;
	if (tsItem) {
		for (let toolbar of Object.values(Toolbars)) {
			let children = (toolbar as any).children;
			if (Array.isArray(children) && children.includes(tsItem)) {
				let index = children.indexOf(tsItem);
				(toolbar as any).add(toggle, index + 1);
				break;
			}
		}
	}

	type CubeSnapshot = { initialOrigin: number[], initialFrom: number[] };
	let snapshots: Map<string, CubeSnapshot> | null = null;
	let trackedCubeUuid: string | null = null;
	let savedUpdatePivotMarker: (typeof Canvas.updatePivotMarker) | null = null;

	// Capture phase: snapshots state before movement begins.
	// Re-parents the pivot marker as a sibling of the cube mesh in the parent's space
	// so Blockbench can't interfere. Position is set to el.origin (same world position).
	//   ON  → pointermove will track geometry
	//   OFF → position stays frozen at initial origin
	function onPointerDown() {
		if (!isHytaleFormat() || !Modes.edit) return;
		if (Toolbox.selected?.id !== 'move_tool') return;
		if (!(Transformer as any)?.axis) return;

		snapshots = new Map();
		for (let el of Outliner.selected) {
			if (el instanceof Cube) {
				snapshots.set(el.uuid, {
					initialOrigin: [...el.origin],
					initialFrom: [...el.from]
				});
			}
		}
		if (snapshots.size === 0) { snapshots = null; return; }

		// Find the first cube to track for the pivot marker
		trackedCubeUuid = null;
		for (let [uuid] of snapshots) {
			let el = OutlinerNode.uuids[uuid];
			if (el instanceof Cube && el.mesh?.parent) {
				trackedCubeUuid = uuid;
				break;
			}
		}
		if (!trackedCubeUuid) return;

		let el = OutlinerNode.uuids[trackedCubeUuid] as Cube;
		savedUpdatePivotMarker = Canvas.updatePivotMarker;
		Canvas.updatePivotMarker = () => {};

		// Preserve the marker's world rotation when moving it to a different parent
		let worldQuat = new THREE.Quaternion();
		Canvas.pivot_marker.getWorldQuaternion(worldQuat);

		el.mesh.parent.add(Canvas.pivot_marker);
		Canvas.pivot_marker.position.set(
			el.origin[0], el.origin[1], el.origin[2]
		);

		// Convert world quaternion to local quaternion in the new parent's space
		let parentWorldQuat = new THREE.Quaternion();
		el.mesh.parent.getWorldQuaternion(parentWorldQuat);
		Canvas.pivot_marker.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
	}

	// Bubble phase (toggle ON only): updates the marker position in parent space
	// to track geometry. No jitter since we own the marker (updatePivotMarker is blocked).
	function onPointerMove() {
		if (!pivotFollowEnabled || !snapshots || !trackedCubeUuid) return;

		let snap = snapshots.get(trackedCubeUuid);
		let el = OutlinerNode.uuids[trackedCubeUuid];
		if (!snap || !(el instanceof Cube) || !el.mesh) return;

		// If Blockbench moved origin, just track it directly.
		// Otherwise compute the visual-space displacement from the from delta.
		let ox = el.origin[0], oy = el.origin[1], oz = el.origin[2];
		if (ox === snap.initialOrigin[0] && oy === snap.initialOrigin[1] && oz === snap.initialOrigin[2]) {
			let dx = el.from[0] - snap.initialFrom[0];
			let dy = el.from[1] - snap.initialFrom[1];
			let dz = el.from[2] - snap.initialFrom[2];
			// Rotate data-space delta by cube quaternion → visual displacement in parent space
			let q = el.mesh.quaternion;
			let qx = q.x, qy = q.y, qz = q.z, qw = q.w;
			let ix = qw*dx + qy*dz - qz*dy;
			let iy = qw*dy + qz*dx - qx*dz;
			let iz = qw*dz + qx*dy - qy*dx;
			let iw = -qx*dx - qy*dy - qz*dz;
			Canvas.pivot_marker.position.set(
				snap.initialOrigin[0] + ix*qw + iw*-qx + iy*-qz - iz*-qy,
				snap.initialOrigin[1] + iy*qw + iw*-qy + iz*-qx - ix*-qz,
				snap.initialOrigin[2] + iz*qw + iw*-qz + ix*-qy - iy*-qx
			);
		} else {
			Canvas.pivot_marker.position.set(ox, oy, oz);
		}
	}

	// Deferred adjustment: runs after Transformer finalises positions and Undo captures state.
	function onPointerUp() {
		if (!snapshots) return;
		let snapshotsCopy = snapshots;
		let savedUpdate = savedUpdatePivotMarker;
		snapshots = null;
		trackedCubeUuid = null;
		savedUpdatePivotMarker = null;

		// Keep updatePivotMarker blocked until after our deferred adjustment
		// to prevent a single-frame flicker where Blockbench re-parents the marker.
		setTimeout(() => {
			if (savedUpdate) {
				Canvas.updatePivotMarker = savedUpdate;
			}
			let modified: OutlinerElement[] = [];
			for (let [uuid, snap] of snapshotsCopy) {
				let el = OutlinerNode.uuids[uuid];
				if (!(el instanceof Cube) || !el.mesh) continue;

				let originMoved =
					el.origin[0] !== snap.initialOrigin[0] ||
					el.origin[1] !== snap.initialOrigin[1] ||
					el.origin[2] !== snap.initialOrigin[2];

				if (pivotFollowEnabled && !originMoved) {
					let delta = new THREE.Vector3(
						el.from[0] - snap.initialFrom[0],
						el.from[1] - snap.initialFrom[1],
						el.from[2] - snap.initialFrom[2]
					);
					delta.applyQuaternion(el.mesh.quaternion);
					let desired: ArrayVector3 = [
						snap.initialOrigin[0] + delta.x,
						snap.initialOrigin[1] + delta.y,
						snap.initialOrigin[2] + delta.z
					];
					el.transferOrigin(desired, false);
					modified.push(el);
				} else if (!pivotFollowEnabled && originMoved) {
					el.transferOrigin(snap.initialOrigin as ArrayVector3, false);
					modified.push(el);
				}
			}

			Canvas.pivot_marker.position.set(0, 0, 0);
			Canvas.pivot_marker.quaternion.identity();
			Canvas.updatePivotMarker();

			if (modified.length > 0) {
				Canvas.updateView({
					elements: modified,
					element_aspects: {transform: true, geometry: true}
				});
			}
		}, 0);
	}

	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('pointermove', onPointerMove, false);
	document.addEventListener('pointerup', onPointerUp, true);

	// TODO: Should this be a vanilla Blockbench feature? Replace hardcoded move to resize toggle with two configurable tool selects.
	// toggle could be made configurable upstream instead of overriding it here.
	// Double-click tool switch override.
	// Replaces Blockbench's hardcoded move↔resize toggle with two configurable tool selects.
	let toolOptions: Record<string, string> = {
		move_tool: 'Move',
		resize_tool: 'Resize',
		rotate_tool: 'Rotate',
		pivot_tool: 'Pivot',
		vertex_snap_tool: 'Vertex Snap',
	};

	let dblClickToolA = new Setting('hytale_dblclick_tool_a', {
		name: 'Double Click Tool A',
		description: 'First tool in the double-click toggle pair. Requires "Double Click Switch Tools" to be enabled in Blockbench controls settings.',
		category: 'controls',
		type: 'select',
		value: 'move_tool',
		options: toolOptions
	});
	track(dblClickToolA);

	let dblClickToolB = new Setting('hytale_dblclick_tool_b', {
		name: 'Double Click Tool B',
		description: 'Second tool in the double-click toggle pair. Requires "Double Click Switch Tools" to be enabled in Blockbench controls settings.',
		category: 'controls',
		type: 'select',
		value: 'pivot_tool',
		options: toolOptions
	});
	track(dblClickToolB);

	let originalToggleTransforms = Toolbox.toggleTransforms;
	Toolbox.toggleTransforms = function() {
		if (!isHytaleFormat()) {
			return originalToggleTransforms.call(this);
		}
		let a = dblClickToolA.value as string;
		let b = dblClickToolB.value as string;
		if (Toolbox.selected.id === a) {
			BarItems[b]?.select();
		} else if (Toolbox.selected.id === b) {
			BarItems[a]?.select();
		}
	};

	track(toggle, {
		delete() {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('pointermove', onPointerMove, false);
			document.removeEventListener('pointerup', onPointerUp, true);
			if (savedUpdatePivotMarker) {
				Canvas.updatePivotMarker = savedUpdatePivotMarker;
				savedUpdatePivotMarker = null;
			}
			Toolbox.toggleTransforms = originalToggleTransforms;
		}
	});
}
