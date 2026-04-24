//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";

const COLOR_CLASS = 'hytale_collection_colored';
const COLOR_VAR = '--hytale-collection-color';
let colorUpdatePending = false;

function scheduleColorUpdate() {
	if (colorUpdatePending) return;
	colorUpdatePending = true;
	requestAnimationFrame(() => {
		colorUpdatePending = false;
		applyCollectionColors();
	});
}

function hexToRgba(hex: string, alpha: number): string {
	let r = parseInt(hex.slice(1, 3), 16);
	let g = parseInt(hex.slice(3, 5), 16);
	let b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyCollectionColors() {
	if (!isHytaleFormat()) return;

	const outlinerPanel = Panels.outliner?.node;
	if (outlinerPanel) {
		outlinerPanel.querySelectorAll(`.${COLOR_CLASS}`).forEach(el => {
			(el as HTMLElement).style.removeProperty(COLOR_VAR);
			el.classList.remove(COLOR_CLASS);
		});
	}

	const collectionsPanel = Panels.collections?.node;
	if (collectionsPanel) {
		collectionsPanel.querySelectorAll('.hytale_collection_icon_colored').forEach(el => {
			(el as HTMLElement).style.removeProperty('color');
			el.classList.remove('hytale_collection_icon_colored');
		});
	}

	for (let collection of Collection.all) {
		if (collection.export_codec !== 'blockymodel') continue;
		// @ts-expect-error color added by plugin
		let colorIndex: number = collection.color;
		if (colorIndex == null || colorIndex < 0) continue;

		let marker = markerColors[colorIndex % markerColors.length];
		let bgColor = hexToRgba(marker.pastel, 0.35);

		// Outliner: background on all child nodes
		if (outlinerPanel) {
			for (let child of collection.getAllChildren()) {
				let li = outlinerPanel.querySelector(`[id="${child.uuid}"]`);
				if (!li) continue;
				let obj = li.querySelector(':scope > .outliner_object');
				if (obj) {
					(obj as HTMLElement).style.setProperty(COLOR_VAR, bgColor);
					obj.classList.add(COLOR_CLASS);
				}
			}
		}

		// Collections panel: tint the icon
		if (collectionsPanel) {
			let li = collectionsPanel.querySelector(`[uuid="${collection.uuid}"]`);
			if (li) {
				let icon = li.querySelector(':scope > i.material-icons');
				if (icon) {
					(icon as HTMLElement).style.color = marker.standard;
					icon.classList.add('hytale_collection_icon_colored');
				}
			}
		}
	}
}

export function setupCollectionColor() {
	let colorProperty = new Property(Collection, 'number', 'color', {
		default: -1,
		condition: { formats: FORMAT_IDS }
	});
	track(colorProperty);

	let colorMenuItem: CustomMenuItem = {
		id: 'set_collection_color',
		name: 'menu.cube.color',
		icon: 'color_lens',
		condition: { formats: FORMAT_IDS },
		children() {
			let items: CustomMenuItem[] = [
				{
					icon: 'block',
					name: 'generic.none',
					click() {
						Undo.initEdit({ collections: Collection.selected });
						for (let collection of Collection.selected) {
							// @ts-expect-error
							collection.color = -1;
						}
						Undo.finishEdit('Remove collection color');
						applyCollectionColors();
					}
				}
			];
			for (let i = 0; i < markerColors.length; i++) {
				let color = markerColors[i];
				items.push({
					icon: 'bubble_chart',
					color: color.standard,
					name: color.name || 'cube.color.' + color.id,
					click() {
						Undo.initEdit({ collections: Collection.selected });
						for (let collection of Collection.selected) {
							// @ts-expect-error
							collection.color = i;
						}
						Undo.finishEdit('Set collection color');
						applyCollectionColors();
					}
				});
			}
			return items;
		}
	};
	Collection.menu.addAction(colorMenuItem, '#settings');
	track({
		delete() {
			Collection.menu.removeAction('set_collection_color');
		}
	});

	let style = Blockbench.addCSS(`
		.outliner_object.${COLOR_CLASS}:not(.selected) {
			background-color: var(${COLOR_VAR});
		}
	`);

	let hookFinishedEdit = Blockbench.on('finished_edit', scheduleColorUpdate);
	let hookSelectMode = Blockbench.on('select_mode', scheduleColorUpdate);
	let hookSelection = Blockbench.on('update_selection', scheduleColorUpdate);

	setTimeout(applyCollectionColors, 100);

	track(hookFinishedEdit, hookSelectMode, hookSelection, style, {
		delete() {
			Panels.outliner?.node?.querySelectorAll(`.${COLOR_CLASS}`).forEach(el => {
				(el as HTMLElement).style.removeProperty(COLOR_VAR);
				el.classList.remove(COLOR_CLASS);
			});
			Panels.collections?.node?.querySelectorAll('.hytale_collection_icon_colored').forEach(el => {
				(el as HTMLElement).style.removeProperty('color');
				el.classList.remove('hytale_collection_icon_colored');
			});
		}
	});
}
