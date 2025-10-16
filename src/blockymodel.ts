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
			let id_count = 1;

			let formatVector = (input: ArrayVector3) => ({
				x: input[0],
				y: input[1],
				z: input[2],
			} as IVector);

			function compileNode(group: Group): BlockymodelNode | undefined {
				let collection = Collection.all.find(c => c.contains(group));
				if (collection && (!options.attachment || options.attachment == collection.uuid)) {
					return;
				}

				let euler = Reusable.euler1.set(
					Math.degToRad(group.rotation[0]),
					Math.degToRad(group.rotation[1]),
					Math.degToRad(group.rotation[2]),
					group.scene_object.rotation.order
				);
				let quaternion = Reusable.quat1.setFromEuler(euler);
				let orientation = {
					x: quaternion.x,
					y: quaternion.y,
					z: quaternion.z,
					w: quaternion.x,
				}
				let node: BlockymodelNode = {
					id: id_count.toString(),
					name: group.name,
					position: formatVector(group.origin),
					orientation,
				}
				id_count++;

				let shape_count = 0;
				for (let child of group.children){
					if (child instanceof Cube && shape_count == 0) {

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
				return autoStringify(model);
			}
		},
		parse(model: BlockymodelJSON, path: string, args?: {attachment?: string}) {
			function parseVector(vec: IVector, fallback: ArrayVector3 = [0, 0, 0]): ArrayVector3 | undefined {
				if (!vec) return fallback;
				return Object.values(vec).slice(0, 3) as ArrayVector3;
			}
			const new_groups: Group[] = [];
			function parseNode(node: BlockymodelNode, parent_node: BlockymodelNode | null, parent_group: Group | 'root' = 'root', parent_offset?: ArrayVector3) {

				let quaternion = new THREE.Quaternion();
				quaternion.set(node.orientation.x, node.orientation.y, node.orientation.z, node.orientation.w);
				let rotation = new THREE.Euler().setFromQuaternion(quaternion.normalize(), 'ZYX');
				let name = node.name;
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
				new_groups.push(group);
				group.addTo(parent_group);

				if (!parent_node && args.attachment) {
					group.name = args.attachment + ':' + group.name,
					group.origin = group.origin;
					console.log(parent_group)

				}
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

					cube.addTo(group).init();
				}

				for (let child of node.children ?? []) {
					parseNode(child, node, group);
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
		icon: 'icon-hytale',
		category: 'file',
		condition: () => Format.id == 'hytale_model',
		click: function () {
			codec.export()
		}
	})
	track(codec, export_action);
	return codec;
}