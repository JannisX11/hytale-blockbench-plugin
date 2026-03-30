//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { setupAttachmentTextures } from "./texture";
import { setupDelete } from "./delete";
import { setupImport } from "./import";
import { setupCreateAttachment } from "./create";
import { setupAddToAttachment } from "./add_to";
import { setupAttachmentValidation } from "./validation";
import { setupAttachmentWatcher } from "./watcher";

export { AttachmentCollection } from "./texture";
export { reload_all_attachments, reloadAttachment } from "./import";

// Double-click collection: open file if export path exists, otherwise properties
function setupCollectionDoubleClick() {
	let originalPropertiesDialog = Collection.prototype.propertiesDialog;
	Collection.prototype.propertiesDialog = function() {
		if (isHytaleFormat() && this.export_path) {
			let openEntry = Collection.menu.structure.find(e => e?.id === 'open');
			if (openEntry && Condition(openEntry.condition, this)) {
				openEntry.click(this);
				return;
			}
		}
		return originalPropertiesDialog.call(this);
	};
	track({
		delete() {
			Collection.prototype.propertiesDialog = originalPropertiesDialog;
		}
	});
}

export function setupAttachments() {
	setupAttachmentTextures();
	setupDelete();
	setupImport();
	setupCreateAttachment();
	setupAddToAttachment();
	setupAttachmentValidation();
	setupAttachmentWatcher();
	setupCollectionDoubleClick();
}
