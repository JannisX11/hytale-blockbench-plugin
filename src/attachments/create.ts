//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { getMainShape } from "../util";
import { AttachmentCollection, processAttachmentTextures } from "./texture";

/**
 * Returns selected groups that are valid for attachment creation:
 * not already in a blockymodel collection, and deduplicated
 * so that if both a parent and descendant are selected, only the parent is kept.
 */
function getSelectedRootGroups(): Group[] {
	let selected = Group.all.filter(g => g.selected);

	// Exclude groups already in a blockymodel collection
	selected = selected.filter(g => !Collection.all.some(c => c.export_codec === 'blockymodel' && c.contains(g)));

	// Deduplicate: if a parent and its descendant are both selected, keep only the parent
	return selected.filter(group => {
		let parent = group.parent;
		while (parent instanceof Group) {
			if (selected.includes(parent)) return false;
			parent = parent.parent;
		}
		return true;
	});
}

/** Collects unique textures used by cubes within the given groups. */
function gatherTexturesFromGroups(groups: Group[]): Texture[] {
	let textureUuids = new Set<string>();
	for (let group of groups) {
		group.forEachChild((node: OutlinerNode) => {
			if (node instanceof Cube) {
				for (let fkey in node.faces) {
					let tex = node.faces[fkey].texture;
					if (typeof tex === 'string') {
						textureUuids.add(tex);
					}
				}
			}
		}, Group, true);
	}
	return Texture.all.filter(t => textureUuids.has(t.uuid));
}

/**
 * Creates is_piece wrapper groups for the selected groups, mirroring the structure
 * that import produces. Groups sharing the same unselected parent get one shared wrapper.
 */
function createIsPieceWrappers(attachmentName: string, selectedGroups: Group[]): Group[] {
	// Map parent group → wrapper group
	let wrappersByParent = new Map<Group, Group>();
	let collectionRoots: Group[] = [];

	for (let group of selectedGroups) {
		let parent = group.parent;

		if (parent instanceof Group) {
			let wrapper = wrappersByParent.get(parent);
			if (!wrapper) {
				// Match the import structure: origin snaps to parent's reference node
				let referenceNode = getMainShape(parent) ?? parent;

				wrapper = new Group({
					name: attachmentName + ':' + parent.name,
					autouv: 1,
					origin: referenceNode.origin.slice(),
					rotation: [0, 0, 0],
					visibility: true,
				});
				wrapper.addTo(parent);
				wrapper.init();
				wrapper.extend({
					is_piece: true,
					original_position: [0, 0, 0],
					original_offset: [0, 0, 0],
				} as any);
				wrapper.color = 1;

				wrappersByParent.set(parent, wrapper);
				collectionRoots.push(wrapper);
			}

			// Reparent the selected group under the wrapper
			group.addTo(wrapper);
		} else {
			// Root-level group: prefix name and add directly
			group.name = attachmentName + ':' + group.name;
			group.color = 1;
			collectionRoots.push(group);
		}
	}

	return collectionRoots;
}

/** Loads textures from a folder path, returning all PNGs found. */
function loadTexturesFromFolder(folderPath: string): Texture[] {
	let fs = requireNativeModule('fs');
	let textures: Texture[] = [];
	try {
		let files = fs.readdirSync(folderPath) as string[];
		for (let fileName of files) {
			if (fileName.match(/\.png$/i)) {
				let fullPath = PathModule.join(folderPath, fileName);
				let existing = Texture.all.find(t => t.path === fullPath);
				if (existing) {
					textures.push(existing);
				} else {
					textures.push(new Texture().fromPath(fullPath).add(false, true));
				}
			}
		}
	} catch (err) {
		console.error('Failed to read texture folder:', err);
	}
	return textures;
}

export function setupCreateAttachment() {
	let create_attachment = new Action('create_hytale_attachment', {
		name: 'Create Attachment',
		icon: 'fa-object-group',
		category: 'file',
		condition: () => Modes.edit && isHytaleFormat() && getSelectedRootGroups().length > 0,
		click() {
			let selectedGroups = getSelectedRootGroups();
			let defaultName = selectedGroups.length === 1 ? selectedGroups[0].name : '';

			new Dialog({
				id: 'create_hytale_attachment',
				title: 'Create Attachment',
				width: 540,
				form: {
					name: {
						label: 'Attachment Name',
						value: defaultName,
					},
					_divider: '_',
					texture_file: {
						label: 'Texture File (optional)',
						type: 'file',
						extensions: ['png'],
						resource_id: 'texture',
					},
					texture_folder: {
						label: 'Texture Folder (optional)',
						type: 'folder',
						resource_id: 'texture',
					},
				},
				onConfirm(result) {
					let name = result.name as string;
					if (!name) {
						Blockbench.showQuickMessage('Attachment name is required', 2000);
						return;
					}

					if (Collection.all.some(c => c.name === name)) {
						Blockbench.showQuickMessage('An attachment with this name already exists', 2000);
						return;
					}

					// Re-check groups are still valid
					selectedGroups = getSelectedRootGroups();
					if (selectedGroups.length === 0) {
						Blockbench.showQuickMessage('No valid groups selected', 2000);
						return;
					}

					// Begin undo: save selected groups' current state (they'll be reparented/renamed)
					Undo.initEdit({
						collections: [],
						groups: selectedGroups,
						outliner: true,
						textures: [],
						// @ts-expect-error
						texture_groups: [],
					});

					// Create is_piece wrapper structure
					let collectionRoots = createIsPieceWrappers(name, selectedGroups);

					// Create collection
					let collection = new Collection({
						name,
						children: collectionRoots.map(g => g.uuid),
						export_codec: 'blockymodel',
						visibility: true,
					}).add() as AttachmentCollection;

					// Handle textures
					let newTextures: Texture[] = [];
					let textureFile = result.texture_file as string;
					let textureFolder = result.texture_folder as string;

					if (textureFile) {
						let existing = Texture.all.find(t => t.path === textureFile);
						newTextures.push(existing ?? new Texture().fromPath(textureFile).add(false, true));
					} else if (textureFolder) {
						newTextures = loadTexturesFromFolder(textureFolder);
					}

					let textureUuid = processAttachmentTextures(name, newTextures);
					if (textureUuid) {
						collection.texture = textureUuid;
					}

					// Find the texture group created by processAttachmentTextures
					let textureGroup = TextureGroup.all.find(tg => tg.name === name);

					// Gather all new wrapper groups created
					let newWrapperGroups = collectionRoots.filter(g => !selectedGroups.includes(g));

					Undo.finishEdit('Create attachment', {
						collections: [collection],
						groups: [...selectedGroups, ...newWrapperGroups],
						outliner: true,
						textures: newTextures,
						// @ts-expect-error
						texture_groups: textureGroup ? [textureGroup] : [],
					});

					Canvas.updateAllFaces();

					// Export (outside undo block — file export is not undoable)
					Codecs.blockymodel.exportCollection(collection);
				}
			}).show();
		}
	});
	track(create_attachment);
}
