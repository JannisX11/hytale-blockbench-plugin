import { track } from "./cleanup"

type BlockymodelJSON = {
	nodes: BlockymodelNode[]
	lod?: 'auto'
}
type BlockymodelNode = {
	id: string
	name: string
	position: IVector
	orientation: IQuaternion
	shape?: {
		offset: IVector
		stretch: IVector
		textureLayout: Record<string, IUvFace>
		type: 'box' | 'none' | 'quad'
		settings: {
			size?: IVector
			normal?: '+X' | '+Y' | '+Z' | '-X' | '-Y' | '-Z'
		}
		unwrapMode: "custom"
		visible: boolean
		doubleSided: boolean
		shadingMode: 'flat' | 'standard' | 'fullbright' | 'reflective'
	}
	children?: BlockymodelNode[]
}
type IUvFace = {
	offset: {x: number, y: number}
	mirror: {x: boolean, y: boolean}
	angle: 0 | 90 | 180 | 270
}
type IVector = {x: number, y: number, z: number}
type IQuaternion = {x: number, y: number, z: number, w: number}

export function setupBlockymodelCodec(): Codec {
	let codec = new Codec('blockymodel', {
		name: 'Hytale Blockymodel',
		extension: 'blockymodel',
		remember: true,
		support_partial_export: true,
		load_filter: {
			type: 'json',
			extensions: ['blockymodel']
		},
		compile(options): string | BlockymodelJSON {
			let model: BlockymodelJSON = {
				nodes: [],
				lod: 'auto'
			}
			if (options.raw) {
				return model;
			} else {
				return autoStringify(model);
			}
		},
		parse(model: BlockymodelJSON, path: string, options?) {
			function parseVector(vec: IVector, fallback: ArrayVector3 = [0, 0, 0]): ArrayVector3 | undefined {
				if (!vec) return fallback;
				return Object.values(vec).slice(0, 3) as ArrayVector3;
			}
			function parseNode(node: BlockymodelNode, parent_node: BlockymodelNode | null, parent_group: Group | 'root' = 'root', parent_offset?: ArrayVector3) {

				let quaternion = new THREE.Quaternion();
				quaternion.set(node.orientation.x, node.orientation.y, node.orientation.z, node.orientation.w);
				let rotation = new THREE.Euler().setFromQuaternion(quaternion.normalize(), 'ZYX');
				let name = node.name.replace(/[-]/g, '_');
				let offset = parseVector(node.shape.offset);
				let position = parseVector(node.position);

				let group = new Group({
					name,
					origin: position,
					rotation: [
						Math.radToDeg(rotation.x),
						Math.radToDeg(rotation.y),
						Math.radToDeg(rotation.z),
					]
				});
				group.addTo(parent_group);

				if (parent_group instanceof Group) {
					let parent_geo_origin = parent_group.children.find(cube => cube instanceof Cube)?.origin ?? parent_group.origin;
					if (parent_geo_origin) {
						group.origin.V3_add(parent_geo_origin);
						if (parent_offset) group.origin.V3_add(parent_offset);
					}
				}
				group.init();


				if (node.shape.type != 'none') {
					let size = parseVector(node.shape.settings.size);
					let stretch = parseVector(node.shape.stretch, [1, 1, 1]);
					if (node.shape.type == 'quad') {
						size[2] = 0;
					}

					let cube = new Cube({
						name,
						rotation: [0, 0, 0],
						stretch,
						from: [
							-size[0]/2 + group.origin[0] + offset[0],
							-size[1]/2 + group.origin[1] + offset[1],
							-size[2]/2 + group.origin[2] + offset[2],
						],
						to: [
							size[0]/2 + group.origin[0] + offset[0],
							size[1]/2 + group.origin[1] + offset[1],
							size[2]/2 + group.origin[2] + offset[2],
						]
					})
					cube.origin.V3_set(
						Math.lerp(cube.from[0], cube.to[0], 0.5),
						Math.lerp(cube.from[1], cube.to[1], 0.5),
						Math.lerp(cube.from[2], cube.to[2], 0.5),
					)

					let temp: number;
					function switchIndices(arr: ArrayVector3 | ArrayVector2, i1: number, i2: number) {
						temp = arr[i1];
						arr[i1] = arr[i2];
						arr[i2] = temp;
					}
					// Plane normal
					if (node.shape.settings?.normal && node.shape.settings.normal != '+Z') {
						switch (node.shape.settings.normal) {
							case '+Y': {
								cube.rotation[0] -= 90;
								switchIndices(cube.stretch, 1, 2);
								break;
							}
							case '-Y': {
								cube.rotation[0] += 90;
								switchIndices(cube.stretch, 1, 2);
								break;
							}
							case '+X': {
								cube.rotation[1] += 90;
								switchIndices(cube.stretch, 2, 2);
								break;
							}
							case '-X': {
								cube.rotation[0] -= 90;
								switchIndices(cube.stretch, 0, 2);
								break;
							}
							case '-Z': {
								cube.rotation[1] += 180;
								break;
							}
						}
					}

					// UV
					if (node.shape.settings.size) {
						function parseUVVector(vec: {x: number, y: number}, fallback: ArrayVector2 = [0, 0]): ArrayVector2 {
							if (!vec) return fallback;
							return Object.values(vec).slice(0, 2) as ArrayVector2;
						}
						for (let key in node.shape.textureLayout) {
							let uv_source = node.shape.textureLayout[key];
							let uv_offset = parseUVVector(uv_source.offset) as ArrayVector2;
							let uv_size = [
								size[0],
								size[1],
							] as ArrayVector2;
							let uv_mirror = [
								uv_source.mirror.x ? -1 : 1,
								uv_source.mirror.y ? -1 : 1,
							] as ArrayVector2;
							let uv_rotation = uv_source.angle;
							let face_name;

							switch (key) {
								case 'back': {
									face_name = 'north';
									break;
								}
								case 'front': {
									face_name = 'south';
									break;
								}
								case 'left': {
									face_name = 'west';
									uv_size[0] = size[2];
									break;
								}
								case 'right': {
									face_name = 'east';
									uv_size[0] = size[2];
									break;
								}
								case 'top': {
									face_name = 'up';
									uv_size[1] = size[2];
									break;
								}
								case 'bottom': {
									face_name = 'down';
									uv_size[1] = size[2];
									break;
								}
							}
							let result: [number, number, number, number] = [0,0,0,0];
							switch (uv_rotation) {
								case 90: {
									switchIndices(uv_size, 0, 1);
									switchIndices(uv_mirror, 0, 1);
									uv_mirror[0] *= -1;
									result = [
										uv_offset[0],
										uv_offset[1] + uv_size[1] * uv_mirror[1],
										uv_offset[0] + uv_size[0] * uv_mirror[0],
										uv_offset[1],
									];
									break;
								}
								case 270: {
									switchIndices(uv_size, 0, 1);
									switchIndices(uv_mirror, 0, 1);
									uv_mirror[1] *= -1;
									result = [
										uv_offset[0] + uv_size[0] * uv_mirror[0],
										uv_offset[1],
										uv_offset[0],
										uv_offset[1] + uv_size[1] * uv_mirror[1],
									];
									break;
								}
								case 180: {
									uv_mirror[0] *= -1;
									uv_mirror[1] *= -1;
									result = [
										uv_offset[0] + uv_size[0] * uv_mirror[0],
										uv_offset[1] + uv_size[1] * uv_mirror[1],
										uv_offset[0],
										uv_offset[1],
									];
									break;
								}
								case 0: {
									result = [
										uv_offset[0],
										uv_offset[1],
										uv_offset[0] + uv_size[0] * uv_mirror[0],
										uv_offset[1] + uv_size[1] * uv_mirror[1],
									];
									break;
								}
							}
							cube.faces[face_name].rotation = uv_rotation;
							cube.faces[face_name].uv = result;
						}
					}

					cube.addTo(group).init();
				}

				for (let child of node.children ?? []) {
					parseNode(child, node, group);
				}
			}

			for (let node of model.nodes) {
				// Roots
				let attachment_node: Group | undefined;
				if (node.shape?.type == 'none' && Group.all.length) {
					attachment_node = Group.all.find(g => g.name == node.name);
				}
				parseNode(node, null, attachment_node);
			}
		}
	})
	let export_action = new Action('export_optifine_part', {
		name: 'Export OptiFine Part',
		description: 'Export a single part for an OptiFine model',
		icon: 'icon-optifine_file',
		category: 'file',
		condition: () => Format.id == 'hytale_model',
		click: function () {
			codec.export()
		}
	})
	track(codec, export_action);
	return codec;
}