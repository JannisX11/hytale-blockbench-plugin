declare global {
	const gizmo_colors: Record<string, THREE.Color>
}

export const ThickLineAxisHelper = class ThickLineAxisHelper extends THREE.LineSegments {
	constructor( size: number = 1 ) {

		let a = 0.04, b = 0.025;

		let vertices = [
			0, a, 0,	size, a, 0,
			0, 0, b,	size, 0, b,
			0, 0, -b,	size, 0, -b,

			0, 0, a,	0, size, a,
			b, 0, 0,	b, size, 0,
			-b, 0, 0,	-b, size, 0,

			a, 0, 0,	a, 0, size,
			0, b, 0,	0, b,  size,
			0, -b, 0,	0, -b, size,
		];

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
		let material = new THREE.LineBasicMaterial( { vertexColors: true } );

		super(geometry, material);
		this.updateColors();
        
        material.transparent = true;
        material.depthTest = false;
        this.renderOrder = 800;
	}
	updateColors() {
		let colors = [
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),

			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),
			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),
			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),

			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
		]
		this.geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	}
}
ThickLineAxisHelper.prototype.constructor = ThickLineAxisHelper;


export class CustomPivotMarker {
	original_helpers: THREE.LineSegments[];

	constructor() {
		this.original_helpers = Canvas.pivot_marker.children.slice() as THREE.LineSegments[];
		let [helper1, helper2] = this.original_helpers;
		let helper1_new = new ThickLineAxisHelper(1);
		let helper2_new = new ThickLineAxisHelper(1);
		helper1_new.rotation.copy(helper1.rotation);
		helper2_new.rotation.copy(helper2.rotation);

		Canvas.pivot_marker.children.empty();
		Canvas.pivot_marker.add(helper1_new, helper2_new);
	}
	
	delete() {
		Canvas.pivot_marker.children.empty();
		Canvas.pivot_marker.add(...this.original_helpers);
	}
}
