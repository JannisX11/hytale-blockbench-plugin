import { track } from "./cleanup";
import { Config } from "./config";
import { FORMAT_IDS } from "./formats";

// TODO(Blockbench): Resizing a stretched cube causes it to drift. The gizmo's move_value
// is in rendered space (stretch applied) but resize() applies it directly to from/to.
// Fix: divide val by stretch, then shift from/to to restore the fixed edge position.
function setupStretchedCubeResizeFix() {
	const originalResize = Cube.prototype.resize;

	Cube.prototype.resize = function(
		val: number | ((n: number) => number),
		axis: number,
		negative?: boolean,
		allow_negative?: boolean,
		bidirectional?: boolean
	) {
		if (!FORMAT_IDS.includes(Format?.id) || !this.isStretched() || this.stretch[axis] === 1) {
			return originalResize.call(this, val, axis, negative, allow_negative, bidirectional);
		}

		const stretch = this.stretch[axis];

		// Save fixed edge position: center (+-) halfSize * stretch
		// (see adjustFromAndToForInflateAndStretch in cube.js)
		let fixedEdgePos: number | null = null;
		if (!bidirectional) {
			const center = (this.from[axis] + this.to[axis]) / 2;
			const halfSize = Math.abs(this.to[axis] - this.from[axis]) / 2;
			fixedEdgePos = negative
				? center + halfSize * stretch
				: center - halfSize * stretch;
		}

		// Convert gizmo's rendered distance to from/to distance
		const adjustedVal = (typeof val === 'function')
			? (n: number) => (val as (n: number) => number)(n * stretch) / stretch
			: val / stretch;

		originalResize.call(this, adjustedVal, axis, negative, allow_negative, bidirectional);

		// Counter resize() moving center
		if (fixedEdgePos !== null) {
			const newCenter = (this.from[axis] + this.to[axis]) / 2;
			const newHalfSize = Math.abs(this.to[axis] - this.from[axis]) / 2;
			const currentEdgePos = negative
				? newCenter + newHalfSize * stretch
				: newCenter - newHalfSize * stretch;

			const drift = fixedEdgePos - currentEdgePos;
			this.from[axis] += drift;
			this.to[axis] += drift;

			this.preview_controller.updateGeometry(this);
		}

		return this;
	};

	track({
		delete() {
			Cube.prototype.resize = originalResize;
		}
	});
}

export function setupElements() {
	setupStretchedCubeResizeFix();
	let property_shading_mode = new Property(Cube, 'enum', 'shading_mode', {
		default: 'flat',
		values: ['flat', 'standard', 'fullbright', 'reflective'],
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {label: 'Shading Mode', type: 'select', options: {
					flat: 'Flat',
					standard: 'Standard',
					fullbright: 'Always Lit',
					reflective: 'Reflective'
				}},
				onChange() {
				}
			}
		}
	});
	track(property_shading_mode);
	let property_double_sided = new Property(Cube, 'boolean', 'double_sided', {
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {label: 'Double Sided', type: 'checkbox'},
				onChange() {
					Canvas.updateView({elements: Cube.all, element_aspects: {transform: true}})
				}
			}
		}
	});
	track(property_double_sided);

	let is_piece_property = new Property(Group, 'boolean', 'is_piece', {
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {
					label: 'Attachment Piece',
					type: 'checkbox',
					description: 'When checked, the node will be attached to a node of the same name when displayed as an attachment in-game.'
				}
			}
		}
	});
	track(is_piece_property);

	let add_quad_action = new Action('hytale_add_quad', {
		name: 'Add Quad',
		icon: 'highlighter_size_5',
		category: 'edit',
		condition: {formats: FORMAT_IDS, modes: ['edit']},
		click() {
			let color = Math.floor(Math.random()*markerColors.length);
			let initial = 'pos_z';

			function runEdit(amended: boolean, normal: string) {
				Undo.initEdit({outliner: true, elements: [], selection: true}, amended);
				let base_quad = new Cube({
					autouv: (settings.autouv.value ? 1 : 0),
					color
				}).init()
				if (!base_quad.box_uv) base_quad.mapAutoUV()
				let group = getCurrentGroup();
				if (group) {
					base_quad.addTo(group)
					if (settings.inherit_parent_color.value) base_quad.color = group.color;
				}

				let texture = (Texture.all.length && Format.single_texture)
					? Texture.getDefault().uuid
					: false;
				for (let face in base_quad.faces) {
					base_quad.faces[face].texture = null;
				}

				let size = [8, 8, 8];
				let positive = normal.startsWith('pos');
				switch (normal[4]) {
					case 'x': {
						base_quad.faces.west.texture = positive ? null : texture;
						base_quad.faces.east.texture = positive ? texture : null;
						size[0] = 0;
						break;
					}
					case 'y': {
						base_quad.faces.down.texture = positive ? null : texture;
						base_quad.faces.up.texture = positive ? texture : null;
						size[1] = 0;
						break;
					}
					case 'z': {
						base_quad.faces.north.texture = positive ? null : texture;
						base_quad.faces.south.texture = positive ? texture : null;
						size[2] = 0;
						break;
					}
				}
				base_quad.extend({
					from: [-size[0]/2, 0, -size[2]/2],
					to: [size[0]/2, size[1], size[2]/2],
				});

				let fkey = Object.keys(base_quad.faces).find(fkey => base_quad.faces[fkey].texture != null);
				UVEditor.getSelectedFaces(base_quad, true).replace([fkey]);

				base_quad.select();
				Canvas.updateView({elements: [base_quad], element_aspects: {transform: true, geometry: true, faces: true}})
				Undo.finishEdit('Add quad', {outliner: true, elements: selected, selection: true});

				Vue.nextTick(function() {
					if (settings.create_rename.value) {
						base_quad.rename()
					}
				})
			}
			runEdit(false, initial);
			
			Undo.amendEdit({
				normal: {
					type: 'inline_select', value: initial, label: 'Normal',
					options: {
						'pos_x': '+X',
						'neg_x': '-X',
						'pos_y': '+Y',
						'neg_y': '-Y',
						'pos_z': '+Z',
						'neg_z': '-Z',
					}
				},
			}, form => {
				runEdit(true, form.normal);
			})
		}
	});
	track(add_quad_action);
	let add_element_menu = ((BarItems.add_element as Action).side_menu as Menu);
	add_element_menu.addAction(add_quad_action);

	// UV workflow
	Blockbench.on('finish_edit', (arg: {aspects: UndoAspects}) => {
        if (!FORMAT_IDS.includes(Format.id)) return;
		if (arg.aspects?.elements) {
			let changes = false;
			for (let element of arg.aspects.elements) {
				if (element instanceof Cube == false) continue;
				if (element.autouv) continue;

				element.autouv = 1;
				element.mapAutoUV();
				element.preview_controller.updateUV(element);
				changes = true;
			}
			if (changes) {
				UVEditor.vue.$forceUpdate();
			}
		}
	});

	let originalAutoUV = Cube.prototype.mapAutoUV;
	Cube.prototype.mapAutoUV = function(options = {}) {
		if (this.box_uv) return;
		var scope = this;
		if (scope.autouv === 2) {
			//Relative UV
			var all_faces = ['north', 'south', 'west', 'east', 'up', 'down']
			let offset = Format.centered_grid ? 8 : 0;
			all_faces.forEach(function(side) {
				var uv = scope.faces[side].uv.slice()
				let texture = scope.faces[side].getTexture();
				let uv_width = Project.getUVWidth(texture);
				let uv_height = Project.getUVWidth(texture);

				switch (side) {
					case 'north':
					uv = [
						uv_width - (scope.to[0]+offset),
						uv_height - scope.to[1],
						uv_width - (scope.from[0]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'south':
					uv = [
						(scope.from[0]+offset),
						uv_height - scope.to[1],
						(scope.to[0]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'west':
					uv = [
						(scope.from[2]+offset),
						uv_height - scope.to[1],
						(scope.to[2]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'east':
					uv = [
						uv_width - (scope.to[2]+offset),
						uv_height - scope.to[1],
						uv_width - (scope.from[2]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'up':
					uv = [
						(scope.from[0]+offset),
						(scope.from[2]+offset),
						(scope.to[0]+offset),
						(scope.to[2]+offset),
					];
					break;
					case 'down':
					uv = [
						(scope.from[0]+offset),
						uv_height - (scope.to[2]+offset),
						(scope.to[0]+offset),
						uv_height - (scope.from[2]+offset),
					];
					break;
				}
				// Clamp to UV map boundaries
				if (Math.max(uv[0], uv[2]) > uv_width) {
					let offset = Math.max(uv[0], uv[2]) - uv_width;
					uv[0] -= offset;
					uv[2] -= offset;
				}
				if (Math.min(uv[0], uv[2]) < 0) {
					let offset = Math.min(uv[0], uv[2]);
					uv[0] = Math.clamp(uv[0] - offset, 0, uv_width);
					uv[2] = Math.clamp(uv[2] - offset, 0, uv_width);
				}
				if (Math.max(uv[1], uv[3]) > uv_height) {
					let offset = Math.max(uv[1], uv[3]) - uv_height;
					uv[1] -= offset;
					uv[3] -= offset;
				}
				if (Math.min(uv[1], uv[3]) < 0) {
					let offset = Math.min(uv[1], uv[3]);
					uv[1] = Math.clamp(uv[1] - offset, 0, uv_height);
					uv[3] = Math.clamp(uv[3] - offset, 0, uv_height);
				}
				scope.faces[side].uv = uv;
			})
			scope.preview_controller.updateUV(scope)
		} else if (scope.autouv === 1) {

			function calcAutoUV(fkey, dimension_axes, world_directions) {
				let size = dimension_axes.map(axis => scope.size(axis));
				let face = scope.faces[fkey];
				size[0] = Math.abs(size[0]);
				size[1] = Math.abs(size[1]);
				let sx = face.uv[0];
				let sy = face.uv[1];
				let previous_size = face.uv_size;
				let rot = face.rotation;

				let texture = face.getTexture();
				let uv_width = Project.getUVWidth(texture);
				let uv_height = Project.getUVHeight(texture);

				//Match To Rotation
				if (rot === 90 || rot === 270) {
					size.reverse()
					dimension_axes.reverse()
					world_directions.reverse()
				}
				if (rot == 180) {
					world_directions[0] *= -1;
					world_directions[1] *= -1;
				}
				//Limit Input to 16
				size[0] = Math.clamp(size[0], -uv_width, uv_width) * (Math.sign(previous_size[0]) || 1);
				size[1] = Math.clamp(size[1], -uv_height, uv_height) * (Math.sign(previous_size[1]) || 1);

				if (options && typeof options.axis == 'number') {
					if (options.axis == dimension_axes[0] && options.direction == world_directions[0]) {
						sx += previous_size[0] - size[0];
					}
					if (options.axis == dimension_axes[1] && options.direction == world_directions[1]) {
						sy += previous_size[1] - size[1];
					}
				}

				//Prevent Negative
				if (sx < 0) sx = 0
				if (sy < 0) sy = 0
				//Calculate End Points
				let endx = sx + size[0];
				let endy = sy + size[1];
				//Prevent overflow
				if (endx > uv_width) {
					sx = uv_width - (endx - sx)
					endx = uv_width
				}
				if (endy > uv_height) {
					sy = uv_height - (endy - sy)
					endy = uv_height
				}
				//Return
				return [sx, sy, endx, endy]
			}
			scope.faces.north.uv = calcAutoUV('north', [0, 1], [1, 1]);
			scope.faces.east.uv =  calcAutoUV('east',  [2, 1], [1, 1]);
			scope.faces.south.uv = calcAutoUV('south', [0, 1], [-1, 1]);
			scope.faces.west.uv =  calcAutoUV('west',  [2, 1], [-1, 1]);
			scope.faces.up.uv =	   calcAutoUV('up',	   [0, 2], [-1, -1]);
			scope.faces.down.uv =  calcAutoUV('down',  [0, 2], [-1, 1]);

			scope.preview_controller.updateUV(scope)
		}
	}
	track({
		delete() {
			Cube.prototype.mapAutoUV = originalAutoUV;
		}
	})
};