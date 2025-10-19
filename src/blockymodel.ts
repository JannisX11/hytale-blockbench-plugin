import { parseAnimationFile } from "./animation"
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
			/**
			 * Dimensions of the cube
			 */
			size?: IVector
			/**
			 * For quads, the normal direction of the plane
			 */
			normal?: '+X' | '+Y' | '+Z' | '-X' | '-Y' | '-Z'
			/**
			 * unknown
			 */
			isPiece?: boolean
			/**
			 * Indicates that the node should be convertex into a basic cube rather than a group containing a group
			 */
			isStaticBox?: true
		}
		unwrapMode: "custom"
		visible: boolean
		doubleSided: boolean
		shadingMode: 'flat' | 'standard' | 'fullbright' | 'reflective'
	}
	children?: BlockymodelNode[]
}
type IUvRot = 0 | 90 | 180 | 270;
type IUvFace = {
	offset: {x: number, y: number}
	mirror: {x: boolean, y: boolean}
	angle: IUvRot
}
type IVector = {x: number, y: number, z: number}
type IQuaternion = {x: number, y: number, z: number, w: number}

type CubeHytale = Cube & {
	shading_mode: 'flat' |'standard' |'fullbright' |'reflective'
	double_sided: boolean
}

interface CompileOptions {
	attachment?: UUID,
	raw?: boolean
}
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
		compile(options: CompileOptions = {}): string | BlockymodelJSON {
			let model: BlockymodelJSON = {
				nodes: [],
				lod: 'auto'
			}
			let node_id = 1;
			const attach_collection = options.attachment && Collection.all.find(c => c.uuid == options.attachment);

			let formatVector = (input: ArrayVector3) => {
				return new oneLiner({
					x: input[0],
					y: input[1],
					z: input[2],
				}) as IVector;
			};
			/*
			Process group
				if no cube, set to shape:none
				if child cube
			*/

			function qualifiesAsMainShape(object: OutlinerNode): boolean {
				return object instanceof Cube && (object.rotation.allEqual(0) || cubeIsQuad(object as CubeHytale));
			}
			function cubeIsQuad(cube: CubeHytale): boolean {
				return cube.size()[2] == 0;
			}
			function turnNodeIntoBox(node: BlockymodelNode, cube: CubeHytale, original_element: CubeHytale | Group) {
				let size = cube.size();
				let stretch = cube.stretch.slice() as ArrayVector3;
				let offset: ArrayVector3 = [
					Math.lerp(cube.from[0], cube.to[0], 0.5) - original_element.origin[0],
					Math.lerp(cube.from[1], cube.to[1], 0.5) - original_element.origin[1],
					Math.lerp(cube.from[2], cube.to[2], 0.5) - original_element.origin[2],
				];
				node.shape.type = 'box';
				node.shape.settings.size = formatVector(size);
				node.shape.offset = formatVector(offset);

				
				let temp: number;
				function switchIndices(arr: ArrayVector3 | ArrayVector2, i1: number, i2: number) {
					temp = arr[i1];
					arr[i1] = arr[i2];
					arr[i2] = temp;
				}
				if (cubeIsQuad(cube)) {
					node.shape.type = 'quad';
					// Detect normal
					if (cube.rotation[0] == -90) {
						node.shape.settings.normal = '+Y';
						switchIndices(stretch, 1, 2);
					} else if (cube.rotation[0] == 90) {
						node.shape.settings.normal = '-Y';
						switchIndices(stretch, 1, 2);
					} else if (cube.rotation[1] == 90) {
						node.shape.settings.normal = '+X';
						switchIndices(stretch, 0, 2);
					} else if (cube.rotation[1] == -90) {
						node.shape.settings.normal = '-X';
						switchIndices(stretch, 0, 2);
					} else if (cube.rotation[1] == 180) {
						node.shape.settings.normal = '-Z';
					} else {
						node.shape.settings.normal = '+Z';
					}
				}
				node.shape.stretch = formatVector(stretch);

				node.shape.visible = true;
				node.shape.doubleSided = cube.double_sided == true;
				node.shape.shadingMode = cube.shading_mode;
				node.shape.unwrapMode = 'custom';

				if (cube == original_element) {
					node.shape.settings.isStaticBox = true;
				}

				// UV
				const BBToHytaleDirection = {
					north: "back",
					south: "front",
					west: "left",
					east: "right",
					up: "top",
					down: "bottom",
				}
				let faces = node.shape.type == 'quad' ? ['south', 'north'] : Object.keys(cube.faces);
				for (let fkey of faces) {
					let face = cube.faces[fkey];
					if (face.texture == null) continue;
					let direction = BBToHytaleDirection[fkey];


					let flip_x = false;
					let flip_y = false;
					let uv_x = Math.min(face.uv[0], face.uv[2]);
					let uv_y = Math.min(face.uv[1], face.uv[3]);
					enum UVAxis {X, Y}
					function flipMinMax(axis: UVAxis) {
						if (axis == UVAxis.X) {
							flip_x = !flip_x;
							if (flip_x) {
								uv_x = Math.max(face.uv[0], face.uv[2]);
							} else {
								uv_x = Math.min(face.uv[0], face.uv[2]);
							}
						} else {
							flip_y = !flip_y;
							if (flip_y) {
								uv_y = Math.max(face.uv[1], face.uv[3]);
							} else {
								uv_y = Math.min(face.uv[1], face.uv[3]);
							}
						}
					}

					let mirror_x = false;
					let mirror_y = false;
					if (face.uv[0] > face.uv[2]) {
						mirror_x = true;
						flipMinMax(UVAxis.X);
					}
					if (face.uv[1] > face.uv[3]) {
						mirror_y = true;
						flipMinMax(UVAxis.Y);
					}

					let uv_rot: IUvRot = 0;

					switch (face.rotation) {
						case 90: {
							uv_rot = 270;
							if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) {
								uv_rot = 90;
							}
							flipMinMax(UVAxis.Y);
							break;
						}
						case 180: {
							uv_rot = 180;
							flipMinMax(UVAxis.Y);
							flipMinMax(UVAxis.X);
							break;
						}
						case 270: {
							uv_rot = 90;
							if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) {
								uv_rot = 270;
							}
							flipMinMax(UVAxis.X);
							break;
						}
					}

					let layout_face: IUvFace = {
						offset: new oneLiner({x: Math.trunc(uv_x), y: Math.trunc(uv_y)}),
						mirror: new oneLiner({x: mirror_x, y: mirror_y}),
						angle: uv_rot,
					};
					node.shape.textureLayout[direction] = layout_face;
				}

			}
			function getNodeOffset(group: Group): ArrayVector3 | undefined {
				let cube = group.children.find(qualifiesAsMainShape) as CubeHytale | undefined;
				if (cube) {
					let center_pos = cube.from.slice().V3_add(cube.to).V3_divide(2, 2, 2);
					center_pos.V3_subtract(group.origin);
					return center_pos;
				}
			}

			function compileNode(element: Group | Cube): BlockymodelNode | undefined {
				// Filter attachment
				if (attach_collection) {
					if (!attach_collection.contains(element)) return;
				} else {
					let collection = Collection.all.find(c => c.contains(element));
					if (collection && (!options.attachment || options.attachment == collection.uuid)) {
						return;
					}
				}

				let euler = Reusable.euler1.set(
					Math.degToRad(element.rotation[0]),
					Math.degToRad(element.rotation[1]),
					Math.degToRad(element.rotation[2]),
					element.scene_object.rotation.order
				);
				let quaternion = Reusable.quat1.setFromEuler(euler);
				let orientation = new oneLiner({
					x: quaternion.x,
					y: quaternion.y,
					z: quaternion.z,
					w: quaternion.w,
				}) as IQuaternion;
				let origin = element.origin.slice() as ArrayVector3;
				if (element.parent instanceof Group) {
					origin.V3_subtract(element.parent.origin);
					let offset = getNodeOffset(element.parent);
					if (offset) {
						origin.V3_subtract(offset);
					}
				}
				let node: BlockymodelNode = {
					id: node_id.toString(),
					name: element.name,
					position: formatVector(origin),
					orientation,
					shape: {
						type: "none",
						offset: formatVector([0, 0, 0]),
						stretch: formatVector([0, 0, 0]),
						settings: {
							isPiece: false
						},
						textureLayout: {},
						unwrapMode: "custom",
						visible: true,
						doubleSided: false,
						shadingMode: "flat"
					},
				}
				node_id++;

				if (element instanceof Cube) {
					turnNodeIntoBox(node, element as CubeHytale, element as CubeHytale);
				} else if ('children' in element) {
					let shape_count = 0;
					for (let child of element.children ?? []) {
						let result: BlockymodelNode;
						if (qualifiesAsMainShape(child) && shape_count == 0) {
							turnNodeIntoBox(node, child as CubeHytale, element);
							shape_count++;

						} else if (child instanceof Cube) {
							result = compileNode(child);
						} else if (child instanceof Group) {
							result = compileNode(child)
						}
						if (result) {
							if (!node.children) node.children = [];
							node.children.push(result);
						}
					}
				}

				return node;
			}
			for (let group of Outliner.root) {
				let compiled = group instanceof Group && compileNode(group);
				if (compiled) model.nodes.push(compiled);
			}

			if (options.raw) {
				return model;
			} else {
				return compileJSON(model, {
					final_newline: false,
					indentation: '  ',
				})
			}
		},
		parse(model: BlockymodelJSON, path: string, args: {attachment?: string} = {}) {
			function parseVector(vec: IVector, fallback: ArrayVector3 = [0, 0, 0]): ArrayVector3 | undefined {
				if (!vec) return fallback;
				return Object.values(vec).slice(0, 3) as ArrayVector3;
			}
			const new_groups: Group[] = [];
			function parseNode(node: BlockymodelNode, parent_node: BlockymodelNode | null, parent_group: Group | 'root' = 'root', parent_offset?: ArrayVector3) {

				let quaternion = new THREE.Quaternion();
				quaternion.set(node.orientation.x, node.orientation.y, node.orientation.z, node.orientation.w);
				let rotation_euler = new THREE.Euler().setFromQuaternion(quaternion.normalize(), 'ZYX');
				let name = node.name;
				let offset = node.shape?.offset ? parseVector(node.shape?.offset) : [0, 0, 0];
				let origin = parseVector(node.position);
				let rotation: ArrayVector3 = [
					Math.radToDeg(rotation_euler.x),
					Math.radToDeg(rotation_euler.y),
					Math.radToDeg(rotation_euler.z),
				];
				
				if (parent_group instanceof Group) {
					let parent_geo_origin = parent_group.children.find(cube => cube instanceof Cube)?.origin ?? parent_group.origin;
					if (parent_geo_origin) {
						origin.V3_add(parent_geo_origin);
						if (parent_offset) origin.V3_add(parent_offset);
					}
				}

				let group: Group | null = null;
				if (!node.shape?.settings?.isStaticBox) {
					group = new Group({
						name,
						origin,
						rotation,
					});
					
					new_groups.push(group);
					group.addTo(parent_group);

					if (!parent_node && args.attachment) {
						group.name = args.attachment + ':' + group.name
					}

					group.init();
				}


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
							-size[0]/2 + origin[0] + offset[0],
							-size[1]/2 + origin[1] + offset[1],
							-size[2]/2 + origin[2] + offset[2],
						],
						to: [
							size[0]/2 + origin[0] + offset[0],
							size[1]/2 + origin[1] + offset[1],
							size[2]/2 + origin[2] + offset[2],
						]
					})
					if (group) {
						cube.origin.V3_set(
							Math.lerp(cube.from[0], cube.to[0], 0.5),
							Math.lerp(cube.from[1], cube.to[1], 0.5),
							Math.lerp(cube.from[2], cube.to[2], 0.5),
						)
					} else {
						cube.extend({
							origin,
							rotation,
						})
					}

					// Properties
					cube.extend({
						// @ts-ignore
						shading_mode: node.shape.shadingMode,
						double_sided: node.shape.doubleSided,
					})

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
								switchIndices(cube.stretch, 0, 2);
								break;
							}
							case '-X': {
								cube.rotation[1] -= 90;
								switchIndices(cube.stretch, 0, 2);
								break;
							}
							case '-Z': {
								cube.rotation[1] += 180;
								break;
							}
						}
					}
					enum HytaleDirection {
						back = "back",
						front = "front",
						left = "left",
						right = "right",
						top = "top",
						bottom = "bottom",
					}
					const HytaleToBBDirection = {
						back: "north",
						front: "south",
						left: "west",
						right: "east",
						top: "up",
						bottom: "down",
					}

					// UV
					if (node.shape.settings.size) {
						function parseUVVector(vec: {x: number, y: number}, fallback: ArrayVector2 = [0, 0]): ArrayVector2 {
							if (!vec) return fallback;
							return Object.values(vec).slice(0, 2) as ArrayVector2;
						}
						for (let key in HytaleDirection) {
							let uv_source = node.shape.textureLayout[key];
							let face_name = HytaleToBBDirection[key];
							if (!uv_source) {
								cube.faces[face_name].texture = null;
								cube.faces[face_name].uv = [0, 0, 0, 0];
								continue;
							}
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

							switch (key) {
								case 'left': {
									uv_size[0] = size[2];
									break;
								}
								case 'right': {
									uv_size[0] = size[2];
									break;
								}
								case 'top': {
									uv_size[1] = size[2];
									break;
								}
								case 'bottom': {
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

					cube.addTo(group || parent_group).init();
				}

				if (node.children?.length && group instanceof Group) {
					for (let child of node.children) {
						parseNode(child, node, group);
					}
				}
			}

			for (let node of model.nodes) {
				// Roots
				let attachment_node: Group | undefined;
				if (args.attachment && node.shape?.type == 'none' && Group.all.length) {
					let node_name = node.name;
					attachment_node = Group.all.find(g => g.name == node_name);
				}
				parseNode(node, null, attachment_node);
			}

			if (path && !args?.attachment) {
				let parts = path.split(/[\\\/]/);
				parts[parts.length-1] = parts.last().split('.')[0];
				Project.name = parts.findLast(p => p != 'Model' && p != 'Models' && p != 'Attachments') ?? 'Model';
			}
			
			const new_textures: Texture[] = [];
			if (isApp && path) {
				let project = Project;
				let dirname = PathModule.dirname(path);
				let fs = requireNativeModule('fs', {scope: PathModule.resolve(dirname, '..')});

				let texture_files = fs.readdirSync(dirname);
				for (let file_name of texture_files) {
					if (file_name.match(/\.png$/i)) {
						let path = PathModule.join(dirname, file_name);
						let texture = Texture.all.find(t => t.path == path);
						if (!texture) {
							texture = new Texture().fromPath(path).add(false, true);
						}
						new_textures.push(texture);
					}
				}
				if (!args?.attachment) {
					let listener = Blockbench.on('select_mode', ({mode}) => {
						if (mode.id != 'animate' || project != Project) return;
						listener.delete();
						try {
							let anim_folders = fs.readdirSync(PathModule.resolve(dirname, '../Animations/'));
							for (let folder of anim_folders) {
								let path = PathModule.resolve(dirname, '../Animations/', folder);
								let anim_files = fs.readdirSync(path);
								for (let file_name of anim_files) {
									if (file_name.match(/\.blockyanim$/i)) {
										let file_path = PathModule.resolve(path, file_name);
										let content = fs.readFileSync(file_path, 'utf-8');
										let json = autoParseJSON(content);
										parseAnimationFile({name: file_name, path: file_path}, json)
									}
								}
							}
						} catch (err) {
							console.error(err);
						}
					});
				}
			}
			return {new_groups, new_textures};
		}
	})
	let export_action = new Action('export_blockymodel', {
		name: 'Export Hytale Blockymodel',
		description: 'Export a blockymodel file',
		icon: 'icon-format_hytale',
		category: 'file',
		condition: () => Format.id == 'hytale_model',
		click: function () {
			codec.export()
		}
	})
	track(codec, export_action);
	MenuBar.menus.file.addAction(export_action, 'export.1');
	return codec;
}
