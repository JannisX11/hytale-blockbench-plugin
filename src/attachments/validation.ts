//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { isUnloaded } from "./unload";

function isPieceHasError(group: Group): boolean {
	// Only cubes as direct children are invalid; an empty piece is allowed.
	for (let child of group.children) {
		if (child instanceof Cube) return true;
	}
	return false;
}

function collectionHasPieceError(collection: Collection): boolean {
	for (let group of Group.all) {
		if (!(group as any).is_piece) continue;
		if (!collection.contains(group)) continue;
		if (isPieceHasError(group)) return true;
	}
	return false;
}

/** Bracketed attachment-name prefix for a piece's error, or empty if it isn't in an attachment. */
function piecePrefix(group: Group): string {
	let c = Collection.all.find(c => c.export_codec === 'blockymodel' && c.contains(group));
	return c ? `[${c.name}] ` : '';
}

/** An outliner node that causes a piece error: a piece with cube children, or such a cube. */
function nodeHasPieceError(node: OutlinerNode): boolean {
	if (node instanceof Group && (node as any).is_piece) {
		return node.children.some(c => c instanceof Cube);
	}
	return node instanceof Cube && node.parent instanceof Group && (node.parent as any).is_piece;
}

/** Aggregates every check's current errors/warnings (the full, unfiltered lists). */
function allValidatorProblems(): {errors: any[], warnings: any[]} {
	let errors: any[] = [];
	let warnings: any[] = [];
	Validator.checks.forEach((check: any) => { errors.push(...check.errors); warnings.push(...check.warnings); });
	return {errors, warnings};
}

/** Opens the standard validator dialog filtered to one attachment, restoring the full list on close. */
function openValidatorForCollection(collection: Collection) {
	let prefix = `[${collection.name}] `;
	Validator.errors.replace(allValidatorProblems().errors.filter(e => typeof e.message === 'string' && e.message.startsWith(prefix)));
	Validator.warnings.empty();
	Validator.openDialog();

	// Restore the global lists when the dialog is dismissed (all exits call hide())
	let dialog: any = Validator.dialog;
	let originalHide = dialog.hide;
	dialog.hide = function(this: any, ...args: any[]) {
		dialog.hide = originalHide;
		let full = allValidatorProblems();
		Validator.errors.replace(full.errors);
		Validator.warnings.replace(full.warnings);
		return originalHide.apply(this, args);
	};
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
			openValidatorForCollection(collection);
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
			message: `The attachment "${collection.name}" has an invalid schema and may not work as expected in-game. Press "Inspect Errors" to review them.`,
			icon: 'warning',
			buttons: ['Save Anyway', 'Inspect Errors'],
			confirm: 0,
			cancel: 1,
		}, (button) => {
			// Save Anyway: proceed. Inspect Errors: cancel the save and open the errors.
			if (button === 0) {
				resolve(true);
			} else {
				resolve(false);
				openValidatorForCollection(collection);
			}
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

				let cubeCount = 0;

				for (let child of group.children) {
					if (child instanceof Cube) cubeCount++;
				}

				if (cubeCount > 0) {
					this.fail({
						message: `${piecePrefix(group)}"${group.name}" has ${cubeCount} cube(s) as direct children. Cubes cannot be direct children of a group marked as "Attachment Piece" : wrap them in a sub-group.`,
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

	// Red mark in the outliner on the pieces/cubes that cause an error (works attached or standalone)
	let outlinerHook = Blockbench.on('get_outliner_node_classes', ({node, classes}: any) => {
		if (isHytaleFormat() && nodeHasPieceError(node)) classes.push('hytale_outliner_error');
	});
	let outlinerStyle = Blockbench.addCSS(`
		.outliner_object.hytale_outliner_error .cube_name { color: var(--color-error); }
		.outliner_object.hytale_outliner_error .outliner_toggle { order: 1; }
		.outliner_object.hytale_outliner_error::after {
			content: 'error';
			font-family: 'Material Icons';
			color: var(--color-error);
			font-size: 15px;
			order: 0;
			margin: 0 4px;
		}
	`);
	track(outlinerHook, { delete() { outlinerStyle.delete(); } });

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

	// Force Save: escape hatch to save an errored attachment so work isn't lost
	let force_save_item: CustomMenuItem = {
		id: 'force_save_hytale_attachment',
		name: 'Force Save',
		icon: 'save',
		condition: (collection: Collection) =>
			isHytaleFormat()
			&& collection instanceof Collection
			&& collection.export_codec === 'blockymodel'
			&& !isUnloaded(collection)
			&& collectionHasPieceError(collection),
		click(collection: Collection) {
			// Same single save prompt as a normal save (confirmSaveWithErrors)
			if (collection.export_path) codec.writeCollection(collection);
			else codec.exportCollection(collection);
		}
	};
	Collection.menu.addAction(force_save_item, 10);
	track({
		delete() {
			Collection.menu.removeAction('force_save_hytale_attachment');
		}
	});
}
