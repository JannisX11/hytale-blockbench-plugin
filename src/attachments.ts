//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { discoverTexturePaths } from "./blockymodel";
import { copyAnimationToGroupsWithSameName } from "./name_overlap";
import {
	AttachmentCollection,
	setupAttachmentTextures,
	processAttachmentTextures,
} from "./attachment_texture";

export { AttachmentCollection } from "./attachment_texture";
export let reload_all_attachments: Action;

// @ts-expect-error
const Animation = window.Animation as typeof _Animation;

// Store orphaned keyframe data on animations so it persists when bones are deleted
// Maps animation -> bone name -> keyframe data
const orphanedAnimatorData: WeakMap<_Animation, Map<string, object[]>> = new WeakMap();

/** Gets orphaned animator data for an animation (used by blockyanim when saving) */
export function getOrphanedAnimatorData(animation: _Animation): Map<string, object[]> | undefined {
	return orphanedAnimatorData.get(animation);
}

/** Saves animator data for groups being deleted, so keyframes persist in saved animations */
function saveOrphanedAnimatorData(groupUuidsToRemove: Set<string>) {
	for (let animation of Animation.all) {
		for (let uuid in animation.animators) {
			if (!groupUuidsToRemove.has(uuid)) continue;

			let animator = animation.animators[uuid];
			if (!(animator instanceof BoneAnimator)) continue;
			if (!animator.keyframes.length) continue;

			let name = animator.name;
			if (!name) continue;

			// Get or create the orphaned data map for this animation
			if (!orphanedAnimatorData.has(animation)) {
				orphanedAnimatorData.set(animation, new Map());
			}
			let animOrphans = orphanedAnimatorData.get(animation)!;

			// Save keyframe data
			let keyframeData = animator.keyframes.map(kf => kf.getUndoCopy());
			animOrphans.set(name, keyframeData);

		}
	}
}

/** Restores saved animation data to newly loaded groups by matching names. */
function restoreAnimatorsToNewGroups(
	new_groups: Group[],
	savedAnimators: Map<string, {animation: _Animation, keyframes: _Keyframe[]}[]>
) {
	let group_by_name: Record<string, Group> = {};
	for (let group of new_groups) {
		group_by_name[group.name] = group;
	}

	for (let [name, animatorDataList] of savedAnimators) {
		let new_group = group_by_name[name];
		if (!new_group) continue;

		for (let {animation, keyframes} of animatorDataList) {
			let animator = animation.getBoneAnimator(new_group);
			for (let kfData of keyframes) {
				animator.addKeyframe(kfData, kfData.uuid);
			}
			// Propagate to all other groups with the same name
			copyAnimationToGroupsWithSameName(animation, new_group);
		}
	}
}

export function setupAttachments() {
	setupAttachmentTextures();

	let shared_delete = SharedActions.add('delete', {
		subject: 'collection',
		priority: 1,
		condition: () => Prop.active_panel == 'collections' && isHytaleFormat() && Collection.selected.find(c => c.export_codec === 'blockymodel'),
		run() {
			let collections = Collection.selected.slice();
			let remove_elements: OutlinerElement[] = [];
			let remove_groups: Group[] = [];
			let textures: Texture[] = [];
			let texture_groups: TextureGroup[] = [];

			for (let collection of collections) {
				if (collection.export_codec === 'blockymodel') {
					for (let child of collection.getAllChildren()) {
						child = child as OutlinerNode;
						(child instanceof Group ? remove_groups : remove_elements).safePush(child);
					}

					let texture_group = TextureGroup.all.find(tg => tg.name === collection.name);
					if (texture_group) {
						let textures2 = Texture.all.filter(t => t.group === texture_group.uuid);
						textures.safePush(...textures2);
						texture_groups.push(texture_group);
					}
				}
			}

			// Save animation data for bones being deleted BEFORE removal
			let groupUuidsToRemove = new Set(remove_groups.map(g => g.uuid));
			saveOrphanedAnimatorData(groupUuidsToRemove);

			Undo.initEdit({
				collections: collections,
				groups: remove_groups,
				elements: remove_elements,
				outliner: true,
				// @ts-expect-error
				texture_groups,
				textures,
			});

			collections.forEach(c => Collection.all.remove(c));
			collections.empty();

			textures.forEach(t => t.remove(true));
			textures.empty();

			texture_groups.forEach(t => t.remove());
			texture_groups.empty();

			remove_groups.forEach(group => group.remove());
			remove_groups.empty();

			remove_elements.forEach(element => element.remove());
			remove_elements.empty();

			updateSelection();
			Undo.finishEdit('Remove attachment');
		}
	});
	track(shared_delete);

	let import_as_attachment = new Action('import_as_hytale_attachment', {
		name: 'Import Attachment',
		icon: 'fa-hat-cowboy',
		condition: {formats: FORMAT_IDS},
		click() {
			Filesystem.importFile({
				extensions: ['blockymodel'],
				type: 'Blockymodel',
				multiple: true,
				startpath: Project.export_path.replace(/[\\\/]\w+.\w+$/, '') + osfs + 'Attachments'
			}, (files) => {
				for (let file of files) {
					let json = autoParseJSON(file.content as string);
					let attachment_name = file.name.replace(/\.\w+$/, '');
					let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: attachment_name});
					let name = file.name.split('.')[0]

					let new_groups = content.new_groups as Group[];
					let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

					let collection = new Collection({
						name,
						children: root_groups.map(g => g.uuid),
						export_codec: 'blockymodel',
						visibility: true,
					}).add() as AttachmentCollection;
					collection.export_path = file.path;

					let texturesToProcess: Texture[] = content.new_textures as Texture[];

					if (texturesToProcess.length === 0) {
						let dirname = PathModule.dirname(file.path);
						let texturePaths = discoverTexturePaths(dirname, attachment_name);
						for (let texPath of texturePaths) {
							let tex = new Texture().fromPath(texPath).add(false);
							texturesToProcess.push(tex);
						}
					}

					let textureUuid = processAttachmentTextures(attachment_name, texturesToProcess);
					if (textureUuid) {
						collection.texture = textureUuid;
					}

					Canvas.updateAllFaces();
				}
			})
		}
	});
	track(import_as_attachment);
	let toolbar = Panels.collections.toolbars[0];
	toolbar.add(import_as_attachment);

	function reloadAttachment(collection: Collection) {
		// Save animation data for attachment bones BEFORE removing groups
		let savedAnimators: Map<string, {animation: _Animation, keyframes: _Keyframe[]}[]> = new Map();
		let attachmentGroupUuids = new Set<string>();
		for (let child of collection.getAllChildren()) {
			if (child instanceof Group) attachmentGroupUuids.add(child.uuid);
		}

		for (let animation of Animation.all) {
			for (let uuid in animation.animators) {
				if (!attachmentGroupUuids.has(uuid)) continue;
				let animator = animation.animators[uuid];
				if (!(animator instanceof BoneAnimator)) continue;
				if (!animator.keyframes.length) continue;

				let name = animator.name;
				if (!savedAnimators.has(name)) savedAnimators.set(name, []);
				savedAnimators.get(name)!.push({
					animation,
					keyframes: animator.keyframes.map(kf => kf.getUndoCopy())
				});
			}
		}

		for (let child of collection.getChildren()) {
			child.remove();
		}

		Filesystem.readFile([collection.export_path], {}, ([file]) => {
			let json = autoParseJSON(file.content as string);
			let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: collection.name});

			let new_groups = content.new_groups as Group[];
			let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

			collection.extend({
				children: root_groups.map(g => g.uuid),
			}).add();

			// Restore animation data to new groups
			restoreAnimatorsToNewGroups(new_groups, savedAnimators);
			Canvas.updateAllFaces();
		})
	}

	let reload_attachment_action = new Action('reload_hytale_attachment', {
		name: 'Reload Attachment',
		icon: 'refresh',
		condition: () => Collection.selected.length && Modes.edit,
		click() {
			for (let collection of Collection.selected) {
				reloadAttachment(collection);
			}
		}
	})
	Collection.menu.addAction(reload_attachment_action, 10);
	track(reload_attachment_action);

	reload_all_attachments = new Action('reload_all_hytale_attachments', {
		name: 'Reload All Attachments',
		icon: 'sync',
		condition: {formats: FORMAT_IDS},
		click() {
			for (let collection of Collection.all.filter(c => c.export_path)) {
				reloadAttachment(collection);
			}
		}
	});
	track(reload_all_attachments);
	toolbar.add(reload_all_attachments);
}
