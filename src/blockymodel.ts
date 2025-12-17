import { parseAnimationFile } from "./blockyanim"
import { track } from "./cleanup"
import { Config } from "./config"
import { FORMAT_IDS } from "./formats"

type BlockymodelJSON = {
	nodes: BlockymodelNode[]
	format?: string
	lod?: 'auto'
}
type QuadNormal = '+X' | '+Y' | '+Z' | '-X' | '-Y' | '-Z';
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
			normal?: QuadNormal
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

type GroupHytale = Group & {
	is_piece: boolean
}

interface CompileOptions {
	attachment?: Collection,
	raw?: boolean
}

/**
 * Discovers texture paths for a model by checking:
 * 1. Same directory - files matching model name or Texture.png
 * 2. {ModelName}_Textures subfolder
 */
export function discoverTexturePaths(dirname: string, modelName: string): string[] {
	let fs = requireNativeModule('fs');
	let paths: string[] = [];

	// 1. Same directory - files matching model name or Texture.png
	let dirFiles = fs.readdirSync(dirname);
	for (let fileName of dirFiles) {
		if (fileName.match(/\.png$/i) && (fileName.startsWith(modelName) || fileName == 'Texture.png')) {
			paths.push(PathModule.join(dirname, fileName));
		}
	}

	// 2. Check for {ModelName}_Textures folder
	let texturesFolderPath = PathModule.join(dirname, `${modelName}_Textures`);
	if (fs.existsSync(texturesFolderPath) && fs.statSync(texturesFolderPath).isDirectory()) {
		let folderFiles = fs.readdirSync(texturesFolderPath);
		for (let fileName of folderFiles) {
			if (fileName.match(/\.png$/i)) {
				paths.push(PathModule.join(texturesFolderPath, fileName));
			}
		}
	}

	// Remove duplicates
	return [...new Set(paths)];
}

/**
 * Loads textures from an array of file paths.
 * Optionally prefers a texture matching preferredName as primary.
 */
function loadTexturesFromPaths(paths: string[], preferredName?: string): Texture[] {
	const textures: Texture[] = [];
	for (let texturePath of paths) {
		let texture = Texture.all.find(t => t.path == texturePath);
		if (!texture) {
			texture = new Texture().fromPath(texturePath).add(false, true);
		}
		textures.push(texture);
	}
	if (textures.length > 0) {
		let primary = (preferredName && textures.find(t => t.name.startsWith(preferredName))) || textures[0];
		if (!Texture.all.find(t => t.use_as_default)) {
			primary.use_as_default = true;
		}
	}
	return textures;
}

/**
 * Prompts the user to import textures when none are found automatically.
 * Offers options to select individual files or a folder containing textures.
 */
function promptForTextures(dirname: string) {
	Blockbench.showMessageBox({
		title: 'Import Textures',
		message: 'No textures were found for this model. How would you like to import textures?',
		buttons: ['Select Files', 'Select Folder', 'Skip'],
	}, (choice) => {
		let project = Project;
		if (choice === 2 || !project) return;

		if (choice === 0) {
			// Select individual texture files
			Blockbench.import({
				resource_id: 'texture',
				extensions: ['png'],
				type: 'PNG Textures',
				multiple: true,
				readtype: 'image',
				startpath: dirname
			}, (files) => {
				if (Project !== project || files.length === 0) return;
				let paths = files.map(f => f.path).filter((p): p is string => !!p);
				loadTexturesFromPaths(paths);
			});
		} else if (choice === 1) {
			// Select folder containing textures
			let folderPath = Blockbench.pickDirectory({
				title: 'Select Texture Folder',
				startpath: dirname,
				resource_id: 'texture'
			});
			if (folderPath && Project === project) {
				let fs = requireNativeModule('fs');
				let files = fs.readdirSync(folderPath);
				let pngFiles = files.filter((f: string) => f.match(/\.png$/i));

				if (pngFiles.length === 0) {
					Blockbench.showQuickMessage('No PNG files found in selected folder');
					return;
				}

				let paths = pngFiles.map((f: string) => PathModule.join(folderPath, f));
				loadTexturesFromPaths(paths);
			}
		}
	});
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
		
		load(model, file, args = {}) {
			let path_segments = file.path && file.path.split(/[\\\/]/);

			// Detect format
			let format = this.format;
			if (model.format) {
				if (model.format == 'prop') {
					format = Formats.hytale_prop;
				}
			} else {
				if (path_segments && path_segments.includes('Blocks')) {
					format = Formats.hytale_prop;
				}
			}

			if (!args.import_to_current_project) {
				setupProject(format)
			}
			if (path_segments && isApp && this.remember && !file.no_file ) {
				path_segments[path_segments.length-1] = path_segments.last().split('.')[0];
				Project.name = path_segments.findLast((p: string) => p != 'Model' && p != 'Models' && p != 'Attachments') ?? 'Model';
				Project.export_path = file.path;
			}

			this.parse(model, file.path, args);

			if (file.path && isApp && this.remember && !file.no_file ) {
				// loadDataFromModelMemory();
				addRecentProject({
					name: Project.name,
					path: Project.export_path,
					icon: Format.icon
				})
				let project = Project;
				setTimeout(() => {
					if (Project == project) updateRecentProjectThumbnail();
				}, 500)
			}
			Settings.updateSettingsInProfiles();
		},
		compile(options: CompileOptions = {}): string | BlockymodelJSON {
			let model: BlockymodelJSON = {
				nodes: [],
				format: Format.id == 'hytale_prop' ? 'prop' : 'character',
				lod: 'auto'
			}
			let node_id = 1;

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
				if (!options.attachment) {
					let collection = Collection.all.find(c => c.contains(element));
					if (collection) return;
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
					name: element.name.replace(/^.+:/, ''),
					position: formatVector(origin),
					orientation,
					shape: {
						type: "none",
						offset: formatVector([0, 0, 0]),
						stretch: formatVector([0, 0, 0]),
						settings: {
							isPiece: (element instanceof Group && (element as GroupHytale).is_piece) || false
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
			let groups = Outliner.root.filter(g => g instanceof Group);
			if (options.attachment instanceof Collection) {
				groups = (options.attachment as Collection).getChildren().filter(g => g instanceof Group);
			}
			for (let group of groups) {
				let compiled = group instanceof Group && compileNode(group);
				if (compiled) model.nodes.push(compiled);
			}

			if (options.raw) {
				return model;
			} else {
				return compileJSON(model, Config.json_compile_options)
			}
		},
		parse(model: BlockymodelJSON, path: string, args: {attachment?: string} = {}) {
			function parseVector(vec: IVector, fallback: ArrayVector3 = [0, 0, 0]): ArrayVector3 | undefined {
				if (!vec) return fallback;
				return Object.values(vec).slice(0, 3) as ArrayVector3;
			}
			const new_groups: Group[] = [];
			const existing_groups = Group.all.slice();
			function parseNode(node: BlockymodelNode, parent_node: BlockymodelNode | null, parent_group: Group | 'root' = 'root', parent_offset?: ArrayVector3) {
				
				if (args.attachment) {
					// Attach groups marked with isPiece: true to matching bones in main model
					let attachment_node: Group | undefined;
					if (args.attachment && node.shape?.settings?.isPiece === true && existing_groups.length) {
						let node_name = node.name;
						attachment_node = existing_groups.find(g => g.name == node_name);
					}
					if (attachment_node) {
						parent_group = attachment_node;
						parent_node = null;
					}
				}

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
				if (args.attachment && !parent_node && parent_group instanceof Group) {
					let reference_node = parent_group.children.find(c => c instanceof Cube) ?? parent_group;
					origin = reference_node.origin.slice() as ArrayVector3;
					rotation = reference_node.rotation.slice() as ArrayVector3;

				} else if (parent_group instanceof Group) {
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
						autouv: 1,
						origin,
						rotation,
					});
					
					new_groups.push(group);
					group.addTo(parent_group);

					if (!parent_node && args.attachment) {
						group.name = args.attachment + ':' + group.name;
						group.color = 1;
					}

					group.init();
					group.extend({
						// @ts-ignore
						is_piece: node.shape?.settings?.isPiece ?? false,
					});
				}


				if (node.shape.type != 'none') {
					let size = parseVector(node.shape.settings.size);
					let stretch = parseVector(node.shape.stretch, [1, 1, 1]);
					if (node.shape.type == 'quad') {
						size[2] = 0;
					}

					let cube = new Cube({
						name,
						autouv: 1,
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
				parseNode(node, null);
			}
			
			let new_textures: Texture[] = [];
			if (isApp && path) {
				let project = Project;
				let dirname = PathModule.dirname(path);
				let model_file_name = pathToName(path, false);
				let fs = requireNativeModule('fs');

				// Discover and load textures
				let texture_paths = discoverTexturePaths(dirname, model_file_name);
				if (texture_paths.length > 0 && !args.attachment) {
					new_textures = loadTexturesFromPaths(texture_paths, Project.name);
				} else if (texture_paths.length > 0) {
					new_textures = loadTexturesFromPaths(texture_paths);
				}

				// If no textures found automatically, prompt user to import
				if (new_textures.length === 0 && !args.attachment) {
					setTimeout(() => {
						if (Project !== project) return;
						promptForTextures(dirname);
					}, 100);
				}

				if (!args?.attachment) {
					let listener = Blockbench.on('select_mode', ({mode}) => {
						if (mode.id != 'animate' || project != Project) return;
						listener.delete();
						let anim_path = PathModule.resolve(dirname, '../Animations/')
						try {
							let anim_folders = fs.existsSync(anim_path) ? fs.readdirSync(anim_path) : [];
							for (let folder of anim_folders) {
								if (folder.includes('.')) continue;
								let path = PathModule.resolve(anim_path, folder);
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
		},
		async export(options?: CompileOptions) {
			if (Object.keys(this.export_options).length) {
				let result = await this.promptExportOptions();
				if (result === null) return;
			}
			Blockbench.export({
				resource_id: 'model',
				type: this.name,
				extensions: [this.extension],
				name: this.fileName(),
				startpath: this.startPath(),
				content: this.compile(options),
				custom_writer: isApp ? (a, b) => this.write(a, b) : null,
			}, path => this.afterDownload(path))
		},
		async exportCollection(collection: Collection) {
			await this.export({attachment: collection});
		},
		async writeCollection(collection: Collection) {
			this.write(this.compile({attachment: collection}), collection.export_path);
		}
	})
	let export_action = new Action('export_blockymodel', {
		name: 'Export Hytale Blockymodel',
		description: 'Export a blockymodel file',
		icon: 'icon-format_hytale',
		category: 'file',
		condition: {formats: FORMAT_IDS},
		click: function () {
			codec.export()
		}
	})
	codec.export_action = export_action;
	track(codec, export_action);
	MenuBar.menus.file.addAction(export_action, 'export.1');

	
	let hook = Blockbench.on('quick_save_model', () => {
		if (FORMAT_IDS.includes(Format.id) == false) return;
		for (let collection of Collection.all) {
			if (collection.export_codec != codec.id) continue;
			codec.writeCollection(collection);
		}
	});
	track(hook);

	return codec;
}
