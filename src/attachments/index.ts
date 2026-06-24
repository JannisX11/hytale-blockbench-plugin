//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { setupAttachmentTextures } from "./texture";
import { setupCloneTexture } from "../clone_texture";
import { setupDelete } from "./delete";
import { setupImport } from "./import";
import { setupCreateAttachment } from "./create";
import { setupAddToAttachment } from "./add_to";
import { setupAttachmentValidation } from "./validation";
import { setupAttachmentWatcher } from "./watcher";
import { setupDetachFromAttachment } from "./detach";
import { setupCollectionColor } from "./collection_color";
import { setupCollectionFolders } from "./collection_folder";
import { setupUnload } from "./unload";

export { AttachmentCollection } from "./texture";
export { reload_all_attachments, reloadAttachment } from "./import";

function setupCollectionDoubleClick() {
	let collectionsNode = Panels.collections?.node;
	if (!collectionsNode) return;

	function onDblClick(e: MouseEvent) {
		if (!isHytaleFormat()) return;
		if ((e.target as HTMLElement).closest('.in_list_button')) return;

		let target = e.target as HTMLElement;
		while (target && !target.classList?.contains('collection')) {
			target = target.parentElement as HTMLElement;
		}
		if (!target) return;

		let uuid = target.getAttribute('uuid');
		let collection = Collection.all.find(c => c.uuid === uuid);
		if (!collection?.export_path) return;

		let openEntry = Collection.menu.structure.find((entry: any) => entry?.id === 'open');
		if (openEntry && Condition(openEntry.condition, collection)) {
			e.stopPropagation();
			openEntry.click(collection);
		}
	}

	collectionsNode.addEventListener('dblclick', onDblClick, true);
	track({
		delete() {
			collectionsNode.removeEventListener('dblclick', onDblClick, true);
		}
	});
}

function setupUnsavedIndicator() {
	let style = Blockbench.addCSS(`
		#collections_list .collection .in_list_button[title]:not(.unclickable):not(.hytale_piece_error_icon) {
			color: var(--color-warning);
		}
	`);
	track({ delete() { style.delete(); } });
}

export function setupAttachments() {
	setupAttachmentTextures();
	setupCloneTexture();
	setupDelete();
	setupImport();
	setupCreateAttachment();
	setupAddToAttachment();
	setupDetachFromAttachment();
	setupAttachmentValidation();
	setupAttachmentWatcher();
	setupCollectionDoubleClick();
	setupUnsavedIndicator();
	setupUnload();
	setupCollectionFolders();
	setupCollectionColor();
}
