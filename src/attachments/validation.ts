//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { getMainShape } from "../util";
import { getOwningAttachment } from "./attach_to";
import { detectProjectHeld, isHeld } from "./held";

type PieceGroup = Group & {is_piece?: boolean};

/** A piece with a main shape exports as a shaped node, which the game doesn't attach. Held items don't attach pieces at all. */
function pieceWontAttach(group: Group): boolean {
	if ((group as PieceGroup).is_piece !== true || !getMainShape(group)) return false;
	let attachment = getOwningAttachment(group);
	return attachment ? !isHeld(attachment) : !detectProjectHeld();
}

function collectionHasPieceWarning(collection: Collection): boolean {
	return Group.all.some(group => collection.contains(group) && pieceWontAttach(group));
}

/** Bracketed attachment-name prefix for a piece's warning, or empty if it isn't in an attachment. */
function piecePrefix(group: Group): string {
	let c = getOwningAttachment(group);
	return c ? `[${c.name}] ` : '';
}

/** Outliner nodes to mark: the piece that won't attach, and its main shape. */
function nodeHasPieceWarning(node: OutlinerNode): boolean {
	if (node instanceof Group) return pieceWontAttach(node);
	return node instanceof Cube && node.parent instanceof Group && pieceWontAttach(node.parent) && getMainShape(node.parent) === node;
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
	let ofCollection = (problems: any[]) => problems.filter(p => typeof p.message === 'string' && p.message.startsWith(prefix));
	let all = allValidatorProblems();
	Validator.errors.replace(ofCollection(all.errors));
	Validator.warnings.replace(ofCollection(all.warnings));
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

const WARNING_ICON_CLASS = 'hytale_piece_warning_icon';

function updateCollectionWarningIcons() {
	if (!isHytaleFormat()) return;

	document.querySelectorAll('.' + WARNING_ICON_CLASS).forEach(el => el.remove());

	for (let collection of Collection.all) {
		if (!collectionHasPieceWarning(collection)) continue;

		let li = document.querySelector(`#collections_list li.collection[uuid="${collection.uuid}"]`);
		if (!li) continue;

		let warningBtn = document.createElement('div');
		warningBtn.className = `in_list_button ${WARNING_ICON_CLASS}`;
		warningBtn.title = 'Some attachment pieces in this attachment won\'t attach in-game';
		warningBtn.innerHTML = '<i class="material-icons icon" style="color: var(--color-warning)">warning</i>';
		warningBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openValidatorForCollection(collection);
		});

		let firstButton = li.querySelector('.in_list_button:not(.' + WARNING_ICON_CLASS + ')');
		if (firstButton) {
			li.insertBefore(warningBtn, firstButton);
		} else {
			li.appendChild(warningBtn);
		}
	}
}

export function setupAttachmentValidation() {
	let piece_check = new ValidatorCheck('hytale_attachment_piece_structure', {
		update_triggers: ['update_selection'],
		condition: {formats: FORMAT_IDS},
		run(this: ValidatorCheck) {
			for (let group of Group.all) {
				if (!pieceWontAttach(group)) continue;
				this.warn({
					message: `${piecePrefix(group)}"${group.name}" is marked as "Attachment Piece" but has a shape (cube "${getMainShape(group)?.name}"), so it won't attach to a bone in-game. Move the cube into a sub-group to make it attach.`,
					buttons: [{
						name: 'Select Group',
						icon: 'fa-folder',
						click() { Validator.dialog.hide(); group.select(); }
					}]
				});
			}

			Vue.nextTick(updateCollectionWarningIcons);
		}
	});
	piece_check.name = 'Hytale Attachment Piece Structure';
	track(piece_check);
	track({
		delete() {
			document.querySelectorAll('.' + WARNING_ICON_CLASS).forEach(el => el.remove());
		}
	});

	// Warning mark in the outliner on pieces that won't attach and their shapes (works attached or standalone)
	let outlinerHook = Blockbench.on('get_outliner_node_classes', ({node, classes}: any) => {
		if (isHytaleFormat() && nodeHasPieceWarning(node)) classes.push('hytale_outliner_warning');
	});
	let outlinerStyle = Blockbench.addCSS(`
		.outliner_object.hytale_outliner_warning .cube_name { color: var(--color-warning); }
		.outliner_object.hytale_outliner_warning .outliner_toggle { order: 1; }
		.outliner_object.hytale_outliner_warning::after {
			content: 'warning';
			font-family: 'Material Icons';
			color: var(--color-warning);
			font-size: 15px;
			order: 0;
			margin: 0 4px;
		}
	`);
	track(outlinerHook, { delete() { outlinerStyle.delete(); } });
}
