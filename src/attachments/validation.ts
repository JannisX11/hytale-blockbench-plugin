//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";

function isPieceHasError(group: Group): boolean {
	let hasGroupChild = false;
	for (let child of group.children) {
		if (child instanceof Group) hasGroupChild = true;
		else if (child instanceof Cube) return true;
	}
	return !hasGroupChild;
}

function collectionHasPieceError(collection: Collection): boolean {
	for (let group of Group.all) {
		if (!(group as any).is_piece) continue;
		if (!collection.contains(group)) continue;
		if (isPieceHasError(group)) return true;
	}
	return false;
}

const ERROR_ICON_CLASS = 'hytale_piece_error_icon';

function updateCollectionErrorIcons() {
	if (!isHytaleFormat()) return;

	document.querySelectorAll('.' + ERROR_ICON_CLASS).forEach(el => el.remove());

	for (let collection of Collection.all) {
		if (!collectionHasPieceError(collection)) continue;

		let li = document.querySelector(`#collections_list li.collection[uuid="${collection.uuid}"]`);
		if (!li) continue;

		let errorBtn = document.createElement('div');
		errorBtn.className = `in_list_button ${ERROR_ICON_CLASS}`;
		errorBtn.title = 'This attachment has invalid piece structure';
		errorBtn.innerHTML = '<i class="material-icons icon" style="color: var(--color-error)">error</i>';
		errorBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			Validator.openDialog();
		});

		let firstButton = li.querySelector('.in_list_button:not(.' + ERROR_ICON_CLASS + ')');
		if (firstButton) {
			li.insertBefore(errorBtn, firstButton);
		} else {
			li.appendChild(errorBtn);
		}
	}
}

/** Shows a warning if the collection has piece errors. Returns true if save should proceed. */
function confirmSaveWithErrors(collection: Collection): Promise<boolean> {
	if (!collectionHasPieceError(collection)) return Promise.resolve(true);

	return new Promise(resolve => {
		Blockbench.showMessageBox({
			title: 'Invalid Attachment Structure',
			message: `The attachment "${collection.name}" has invalid "Attachment Piece" structure. Cubes cannot be direct children of a group marked as "Attachment Piece". This attachment may not work correctly in-game.`,
			icon: 'error',
			buttons: ['Save Anyway', 'Cancel'],
			confirm: 0,
			cancel: 1,
		}, (button) => {
			resolve(button === 0);
		});
	});
}

export function setupAttachmentValidation() {
	let piece_check = new ValidatorCheck('hytale_attachment_piece_structure', {
		update_triggers: ['update_selection'],
		condition: {formats: FORMAT_IDS},
		run(this: ValidatorCheck) {
			for (let group of Group.all) {
				if (!(group as any).is_piece) continue;

				let hasGroupChild = false;
				let cubeCount = 0;

				for (let child of group.children) {
					if (child instanceof Group) hasGroupChild = true;
					else if (child instanceof Cube) cubeCount++;
				}

				if (cubeCount > 0) {
					this.fail({
						message: `"${group.name}" has ${cubeCount} cube(s) as direct children. Cubes cannot be direct children of a group marked as "Attachment Piece" : wrap them in a sub-group.`,
						buttons: [{
							name: 'Select Group',
							icon: 'fa-folder',
							click() { Validator.dialog.hide(); group.select(); }
						}]
					});
				}

				if (!hasGroupChild) {
					this.fail({
						message: `"${group.name}" is marked as "Attachment Piece" but has no group children. Add at least one sub-group for the attachment to work in-game.`,
						buttons: [{
							name: 'Select Group',
							icon: 'fa-folder',
							click() { Validator.dialog.hide(); group.select(); }
						}]
					});
				}
			}

			Vue.nextTick(updateCollectionErrorIcons);
		}
	});
	piece_check.name = 'Hytale Attachment Piece Structure';
	track(piece_check);
	track({
		delete() {
			document.querySelectorAll('.' + ERROR_ICON_CLASS).forEach(el => el.remove());
		}
	});

	// Warn on save if attachment has piece structure errors
	let codec = Codecs.blockymodel;
	let originalExportCollection = codec.exportCollection.bind(codec);
	let originalWriteCollection = codec.writeCollection.bind(codec);

	codec.exportCollection = async function(collection: Collection) {
		if (await confirmSaveWithErrors(collection)) {
			return originalExportCollection(collection);
		}
	};
	codec.writeCollection = async function(collection: Collection) {
		if (await confirmSaveWithErrors(collection)) {
			return originalWriteCollection(collection);
		}
	};

	track({
		delete() {
			codec.exportCollection = originalExportCollection;
			codec.writeCollection = originalWriteCollection;
		}
	});
}
