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
		// Origin is always kept as the last vertex
		let origin = [0, 0, 0];
		rebuildPointsGeometry(pts, [...snapPoints, origin]);
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
		}
	});
}
