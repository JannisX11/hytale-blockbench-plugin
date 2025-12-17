import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

// Attachments manage their own textures separately from Blockbench's texture panel

export type AttachmentCollection = Collection & {
	texture_path: string;
	selected_texture: string;
}

type CachedMaterial = {
	material: THREE.ShaderMaterial;
	texture: THREE.Texture;
	image: HTMLImageElement;
}

const attachmentMaterials = new Map<string, CachedMaterial>();

/**
 * Path resolution
 */

function getTextureFilePath(collection: AttachmentCollection): string {
	if (!collection.texture_path) return '';

	let fs = requireNativeModule('fs');
	if (!fs.existsSync(collection.texture_path)) return '';

	let stat = fs.statSync(collection.texture_path);
	if (stat.isFile()) {
		return collection.texture_path;
	}
	if (stat.isDirectory() && collection.selected_texture) {
		return PathModule.join(collection.texture_path, collection.selected_texture);
	}
	return '';
}

function isTextureSingleFile(collection: AttachmentCollection): boolean {
	if (!collection.texture_path) return false;
	let fs = requireNativeModule('fs');
	if (!fs.existsSync(collection.texture_path)) return false;
	return fs.statSync(collection.texture_path).isFile();
}

export function scanTexturesAtPath(texturePath: string): {name: string, path: string, dataUrl: string}[] {
	let fs = requireNativeModule('fs');
	let textures: {name: string, path: string, dataUrl: string}[] = [];

	if (!texturePath || !fs.existsSync(texturePath)) return textures;

	let stat = fs.statSync(texturePath);
	if (stat.isFile() && texturePath.match(/\.png$/i)) {
		textures.push({
			name: PathModule.basename(texturePath),
			path: texturePath,
			dataUrl: texturePath
		});
	} else if (stat.isDirectory()) {
		for (let fileName of fs.readdirSync(texturePath)) {
			if (fileName.match(/\.png$/i)) {
				let filePath = PathModule.join(texturePath, fileName);
				textures.push({ name: fileName, path: filePath, dataUrl: filePath });
			}
		}
	}
	return textures;
}

/**
 * Material management
 */

export function clearAttachmentMaterial(uuid: string): void {
	let cached = attachmentMaterials.get(uuid);
	if (cached) {
		cached.texture.dispose();
		cached.material.dispose();
		attachmentMaterials.delete(uuid);
	}
}

export function clearAllAttachmentMaterials(): void {
	for (let [, data] of attachmentMaterials) {
		data.texture.dispose();
		data.material.dispose();
	}
	attachmentMaterials.clear();
}

export function getAttachmentMaterial(collection: AttachmentCollection): THREE.ShaderMaterial | null {
	let cached = attachmentMaterials.get(collection.uuid);
	if (cached) return cached.material;

	let texturePath = getTextureFilePath(collection);
	if (!texturePath) return null;

	let fs = requireNativeModule('fs');
	if (!fs.existsSync(texturePath)) return null;

	// Placeholder canvas where the image will be drawn when loaded
	let canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;

	let tex = new THREE.Texture(canvas);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;

	// Reuse Blockbench's shader and uniforms for consistent lighting
	let mat = new THREE.ShaderMaterial({
		uniforms: {
			map: { type: 't', value: tex },
			SHADE: { type: 'bool', value: settings.shading.value },
			LIGHTCOLOR: { type: 'vec3', value: new THREE.Color().copy(Canvas.global_light_color).multiplyScalar(settings.brightness.value / 50) },
			LIGHTSIDE: { type: 'int', value: Canvas.global_light_side },
			EMISSIVE: { type: 'bool', value: false }
		},
		vertexShader: Texture.all[0]?.getMaterial()?.vertexShader || '',
		fragmentShader: Texture.all[0]?.getMaterial()?.fragmentShader || '',
		side: THREE.DoubleSide,
		transparent: true,
	});
	// @ts-ignore
	mat.map = tex;

	// Load image async
	// When ready, draw to canvas and trigger texture update
	let img = new Image();
	img.onload = () => {
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		let ctx = canvas.getContext('2d');
		if (ctx) {
			ctx.drawImage(img, 0, 0);
			tex.needsUpdate = true;
			Canvas.updateAllFaces();
		}
	};
	img.src = texturePath;

	attachmentMaterials.set(collection.uuid, { material: mat, texture: tex, image: img });
	return mat;
}

/**
 * Collection lookup
 */

function getCollection(cube: Cube): AttachmentCollection | undefined {
	return Collection.all.find(c => c.contains(cube)) as AttachmentCollection | undefined;
}

/**
 * Properties dialog UI
 */

function injectTextureSection(collection: AttachmentCollection) {
	let dialogEl = document.getElementById('collection_properties');
	if (!dialogEl) return;

	let dialogContent = dialogEl.querySelector('.dialog_content');
	if (!dialogContent) return;

	if (dialogEl.querySelector('#attachment_texture_section')) return;

	let section = document.createElement('div');
	section.id = 'attachment_texture_section';
	section.innerHTML = buildTextureSectionHTML(collection);
	dialogContent.appendChild(section);

	setupTextureSectionHandlers(section, collection);
}

function buildTextureSectionHTML(collection: AttachmentCollection): string {
	let textures = scanTexturesAtPath(collection.texture_path);
	let isSingleFile = isTextureSingleFile(collection);

	let gridContent = textures.length === 0
		? '<div style="flex: 1; text-align: center; color: var(--color-subtle_text); padding: 16px;">No textures found</div>'
		: textures.map(tex => {
			let isSelected = isSingleFile || collection.selected_texture === tex.name;
			return `
				<div class="att_tex_item${isSelected ? ' selected' : ''}" data-name="${tex.name}" data-path="${tex.path}">
					<img src="${tex.dataUrl}">
					<div class="att_tex_name">${tex.name}</div>
				</div>
			`;
		}).join('');

	return `
		<div class="dialog_bar form_bar form_bar_file">
			<label class="name_space_left">Texture Path</label>
			<div class="input_wrapper">
				<input type="text" class="dark_bordered" id="att_tex_path" value="${collection.texture_path || ''}">
				<i class="material-icons" id="att_browse_btn" style="cursor: pointer;">folder_open</i>
			</div>
		</div>

		<div id="att_tex_grid" style="display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; padding-bottom: 4px;">
			${gridContent}
		</div>

		<style>
			#att_tex_grid .att_tex_item { cursor: pointer; text-align: center; padding: 6px; border-radius: 4px; background: var(--color-back); border: 2px solid transparent; flex-shrink: 0; width: 88px; }
			#att_tex_grid .att_tex_item.selected { border-color: var(--color-accent); background: var(--color-selected); }
			#att_tex_grid .att_tex_item:hover:not(.selected) { background: var(--color-button); }
			#att_tex_grid .att_tex_item img { width: 76px; height: 76px; object-fit: contain; image-rendering: pixelated; }
			#att_tex_grid .att_tex_name { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 76px; }
		</style>
	`;
}

function setupTextureSectionHandlers(section: HTMLElement, collection: AttachmentCollection) {
	let pathInput = section.querySelector('#att_tex_path') as HTMLInputElement;

	function refreshGrid() {
		let grid = section.querySelector('#att_tex_grid') as HTMLElement;
		if (!grid) return;

		let textures = scanTexturesAtPath(collection.texture_path);
		let isSingleFile = isTextureSingleFile(collection);

		grid.innerHTML = textures.length === 0
			? '<div style="flex: 1; text-align: center; color: var(--color-subtle_text); padding: 16px;">No textures found</div>'
			: textures.map(tex => {
				let isSelected = isSingleFile || collection.selected_texture === tex.name;
				return `
					<div class="att_tex_item${isSelected ? ' selected' : ''}" data-name="${tex.name}" data-path="${tex.path}">
						<img src="${tex.dataUrl}">
						<div class="att_tex_name">${tex.name}</div>
					</div>
				`;
			}).join('');

		attachGridClickHandlers();
	}

	function attachGridClickHandlers() {
		section.querySelectorAll('#att_tex_grid .att_tex_item').forEach(item => {
			item.addEventListener('click', () => {
				section.querySelectorAll('#att_tex_grid .att_tex_item').forEach(i => i.classList.remove('selected'));
				item.classList.add('selected');

				if (!isTextureSingleFile(collection)) {
					collection.selected_texture = item.getAttribute('data-name') || '';
				}
				clearAttachmentMaterial(collection.uuid);
				Canvas.updateAllFaces();
			});
		});
	}

	attachGridClickHandlers();

	section.querySelector('#att_browse_btn')?.addEventListener('click', () => {
		let startPath = collection.texture_path || (collection.export_path ? PathModule.dirname(collection.export_path) : '');

		let folderPath = Blockbench.pickDirectory({
			title: 'Select Texture Folder',
			startpath: startPath,
			resource_id: 'texture'
		});

		if (folderPath) {
			collection.texture_path = folderPath;
			pathInput.value = folderPath;
			clearAttachmentMaterial(collection.uuid);

			let textures = scanTexturesAtPath(folderPath);
			if (textures.length > 0) {
				collection.selected_texture = textures[0].name;
				getAttachmentMaterial(collection);
			}

			refreshGrid();
			Canvas.updateAllFaces();
		}
	});

	pathInput?.addEventListener('change', () => {
		let fs = requireNativeModule('fs');
		let newPath = pathInput.value;

		if (!newPath || !fs.existsSync(newPath)) return;

		collection.texture_path = newPath;
		clearAttachmentMaterial(collection.uuid);

		if (fs.statSync(newPath).isFile()) {
			collection.selected_texture = '';
		} else {
			let textures = scanTexturesAtPath(newPath);
			if (textures.length > 0) {
				collection.selected_texture = textures[0].name;
			}
		}

		getAttachmentMaterial(collection);
		refreshGrid();
		Canvas.updateAllFaces();
	});
}

/**
 * Setup
 */

export function setupAttachmentTextures() {
	let texture_path_property = new Property(Collection, 'string', 'texture_path', {
		condition: { formats: FORMAT_IDS }
	});
	track(texture_path_property);

	let selected_texture_property = new Property(Collection, 'string', 'selected_texture', {
		condition: { formats: FORMAT_IDS }
	});
	track(selected_texture_property);

	// Build an object with the properties Blockbench expects from a Texture
	// Keeps attachment textures separate from the main texture panel
	let originalGetTexture = CubeFace.prototype.getTexture;
	CubeFace.prototype.getTexture = function(...args) {
		if (isHytaleFormat()) {
			if (this.texture == null) return null;

			let collection = getCollection(this.cube);
			if (collection?.export_codec === 'blockymodel') {
				if (collection.texture_path) {
					let material = getAttachmentMaterial(collection as AttachmentCollection);
					if (material) {
						let cached = attachmentMaterials.get(collection.uuid);
						let img = cached?.image;
						let width = img?.naturalWidth || 64;
						let height = img?.naturalHeight || 64;

						// getMaterial() provides our material, other properties are for UV calculations
						return {
							uuid: collection.uuid + '_tex',
							getMaterial: () => material,
							getOwnMaterial: () => material,
							img,
							width,
							height,
							uv_width: width,
							uv_height: height,
							display_height: height,
							frameCount: 1,
							currentFrame: 0,
							getUVWidth: () => width,
							getUVHeight: () => height,
							source: cached?.image?.src || '',
							selected: false,
							show_icon: true,
							particle: false,
							use_as_default: false,
						};
					}
				}
				// No texture so Blockbench will use empty material
				return null;
			}
		}
		return originalGetTexture.call(this, ...args);
	};
	track({ delete() { CubeFace.prototype.getTexture = originalGetTexture; } });

	let originalPropertiesDialog = Collection.prototype.propertiesDialog;
	Collection.prototype.propertiesDialog = function() {
		originalPropertiesDialog.call(this);
		if (isHytaleFormat() && this.export_codec === 'blockymodel') {
			setTimeout(() => injectTextureSection(this as AttachmentCollection), 10);
		}
	};
	track({ delete() { Collection.prototype.propertiesDialog = originalPropertiesDialog; } });

	track({ delete() { clearAllAttachmentMaterials(); } });
}
