//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";

// Vertex order from geometry buffer dedup:
//   0:(to,to,to) 1:(to,to,from) 2:(to,from,to) 3:(to,from,from)
//   4:(from,to,from) 5:(from,to,to) 6:(from,from,from) 7:(from,from,to)
const CUBE_EDGES: [number, number][] = [
	[0, 1], [0, 5], [1, 4], [4, 5], // Top face
	[2, 3], [2, 7], [3, 6], [6, 7], // Bottom face
	[0, 2], [1, 3], [4, 6], [5, 7], // Vertical
];

const CUBE_FACES: number[][] = [
	[0, 1, 2, 3], // East  (x = to)
	[4, 5, 6, 7], // West  (x = from)
	[0, 1, 4, 5], // Up    (y = to)
	[2, 3, 6, 7], // Down  (y = from)
	[0, 2, 5, 7], // South (z = to)
	[1, 3, 4, 6], // North (z = from)
];

function midpoint(a: number[], b: number[]): number[] {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function centroid(points: number[][]): number[] {
	let x = 0, y = 0, z = 0;
	for (let p of points) { x += p[0]; y += p[1]; z += p[2]; }
	let n = points.length;
	return [x / n, y / n, z / n];
}

type SnapPointMode = 'vertex' | 'edge' | 'face';

function getSnapTo(): SnapPointMode {
	return (BarItems.snap_to as any)?.value ?? 'vertex';
}

function buildSnapPoints(corners: number[][], mode: SnapPointMode): number[][] {
	let points: number[][] = [];

	if (mode === 'vertex') {
		points.push(...corners);
	} else if (mode === 'edge') {
		for (let [a, b] of CUBE_EDGES) {
			points.push(midpoint(corners[a], corners[b]));
		}
	} else {
		for (let face of CUBE_FACES) {
			points.push(centroid(face.map(i => corners[i])));
		}
	}

	return points;
}

function rebuildPointsGeometry(pts: any, verts: number[][]) {
	let positions: number[] = [];
	let colors: number[] = [];
	let { r, g, b } = gizmo_colors.grid;
	for (let v of verts) {
		positions.push(v[0], v[1], v[2]);
		colors.push(r, g, b);
	}
	pts.vertices = verts;
	pts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
	pts.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
}

let _accentColor: THREE.Color | null = null;
function getAccentColor(): THREE.Color {
	if (!_accentColor) {
		let css = getComputedStyle(document.body).getPropertyValue('--color-accent').trim();
		_accentColor = new THREE.Color(css || '#3e90ff');
	}
	return _accentColor;
}

function setParentPivotColor(pts: any) {
	if (pts._parent_pivot_index == null) return;
	let colorAttr = pts.geometry.attributes.color;
	if (!colorAttr) return;
	let idx = pts._parent_pivot_index * 3;
	if (idx + 2 >= colorAttr.array.length) return;
	let accent = getAccentColor();
	colorAttr.array[idx] = accent.r;
	colorAttr.array[idx + 1] = accent.g;
	colorAttr.array[idx + 2] = accent.b;
	colorAttr.needsUpdate = true;
}

export function setupPivotSnap() {
	let originalAddVertices = Vertexsnap.addVertices;

	Vertexsnap.addVertices = function (element: any) {
		originalAddVertices.call(this, element);

		let { mesh } = element;
		if (!mesh?.vertex_points) return;
		if (!(element instanceof Cube)) return;

		let pts = mesh.vertex_points;
		let verts: number[][] = pts.vertices;
		if (verts.length < 9) return;

		let corners = verts.slice(0, 8);
		pts._snap_corners = corners;

		let mode = getSnapTo();
		let snapPoints = buildSnapPoints(corners, mode);
		let origin = [0, 0, 0];
		let allPoints = [...snapPoints, origin];

		pts._parent_pivot_index = null;
		let parentGroup = element.parent;
		if (parentGroup instanceof Group && parentGroup.mesh) {
			let groupWorldPos = new THREE.Vector3();
			parentGroup.mesh.getWorldPosition(groupWorldPos);
			let localPos = mesh.worldToLocal(groupWorldPos.clone());
			pts._parent_pivot_index = allPoints.length;
			allPoints.push(localPos.toArray());
		}

		rebuildPointsGeometry(pts, allPoints);
		setParentPivotColor(pts);
		if (pts._parent_pivot_index != null) {
			pts.renderOrder = 901;
		}
	};

	let originalCanvasClick = Vertexsnap.canvasClick;
	let _parentPivotGroup: any = null;

	Vertexsnap.canvasClick = function (data: any) {
		// Step 1: pick parent group pivot as snap source
		if (data?.type === 'vertex' && Vertexsnap.step1) {
			let pts = data.element?.mesh?.vertex_points;
			if (pts?._parent_pivot_index != null && data.vertex_index === pts._parent_pivot_index) {
				let parentGroup = data.element.parent;
				if (parentGroup instanceof Group) {
					Vertexsnap.step1 = false;
					Vertexsnap.vertex_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
					_parentPivotGroup = parentGroup;
					Vertexsnap.clearVertexGizmos();
					$('#preview').css('cursor', 'alias');
					Blockbench.setStatusBarText();
					return;
				}
			}
		}

		// Step 2: snap parent group pivot to target
		if (!Vertexsnap.step1 && _parentPivotGroup) {
			if (!data) return;
			if (data.type !== 'vertex' && !['locator', 'null_object'].includes(data.element?.type)) return;

			let group = _parentPivotGroup;
			let allGroups: any[] = [group];
			group.forEachChild((child: any) => { allGroups.push(child); }, Group);
			let elements: any[] = [];
			group.forEachChild((child: any) => { elements.push(child); }, OutlinerElement);

			Undo.initEdit({ elements, groups: allGroups, outliner: true });

			let vec = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			if (Format.bone_rig && group.parent instanceof Group && group.mesh.parent) {
				group.mesh.parent.worldToLocal(vec);
			}
			let vec_array: any = vec.toArray();
			if (group.parent instanceof Group) {
				vec_array.V3_add(group.parent.origin);
			}

			group.transferOrigin(vec_array);
			Canvas.updateAllBones(allGroups);
			Canvas.updateView({
				elements,
				element_aspects: { transform: true, geometry: true },
				selection: true,
			});

			Undo.finishEdit('Use vertex snap');

			_parentPivotGroup = null;
			Vertexsnap.step1 = true;
			$('#preview').css('cursor', 'copy');
			Blockbench.setStatusBarText();
			return;
		}

		originalCanvasClick.call(this, data);
	};

	let originalHoverCanvas = Vertexsnap.hoverCanvas;
	Vertexsnap.hoverCanvas = function (event: any) {
		originalHoverCanvas.call(this, event);
		for (let el of Vertexsnap.elements_with_vertex_gizmos) {
			let pts = (el as any).mesh?.vertex_points;
			if (!pts || pts._parent_pivot_index == null) continue;
			let colorAttr = pts.geometry.attributes.color;
			if (!colorAttr) continue;
			let idx = pts._parent_pivot_index * 3;
			if (idx + 2 >= colorAttr.array.length) continue;
			let { r, g, b } = gizmo_colors.grid;
			if (colorAttr.array[idx] === r && colorAttr.array[idx + 1] === g && colorAttr.array[idx + 2] === b) {
				let accent = getAccentColor();
				colorAttr.array[idx] = accent.r;
				colorAttr.array[idx + 1] = accent.g;
				colorAttr.array[idx + 2] = accent.b;
				colorAttr.needsUpdate = true;
			}
		}
	};

	let snapTo = new BarSelect('snap_to', {
		options: {
			vertex: { name: 'Vertex', icon: 'fiber_manual_record' },
			edge: { name: 'Edge', icon: 'pen_size_3' },
			face: { name: 'Face', icon: 'far.fa-square' },
		},
		icon_mode: true,
		condition: () => Toolbox.selected?.id === 'vertex_snap_tool',
		onChange() {
			Vertexsnap.clearVertexGizmos();
			Vertexsnap.select();
		}
	});
	track(snapTo);

	let toolbar = Toolbars.vertex_snap;
	if (toolbar) {
		let origChildren = toolbar.default_children.slice();
		toolbar.default_children.splice(1, 0, 'snap_to');
		toolbar.build({ children: toolbar.default_children });
		track({
			delete() {
				toolbar.default_children = origChildren;
				toolbar.build({ children: origChildren });
			}
		});
	}

	track({
		delete() {
			Vertexsnap.addVertices = originalAddVertices;
			Vertexsnap.canvasClick = originalCanvasClick;
			Vertexsnap.hoverCanvas = originalHoverCanvas;
		}
	});
}
