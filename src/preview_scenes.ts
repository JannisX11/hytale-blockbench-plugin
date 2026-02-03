//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from './cleanup';
import PlayerModelJSON from './references/player.json'
import PlayerTexture from './references/player.png'
import DefaultScene from './references/default.json'
import DefaultTexture from './references/default/default.png'
import { FORMAT_IDS } from './formats';

declare global {
	const ViewOptionsDialog: Dialog
}

export function setupPreviewScenes() {
    PreviewScene.menu_categories.hytale = {
		_label: 'Hytale'
    };
    
    let base_path = 'https://cdn.jsdelivr.net/gh/JannisX11/hytale-blockbench-plugin/src/references/default/';
	DefaultScene.preview_models.forEach(model => model.texture = DefaultTexture);
    new PreviewScene('hytale_default', {
		...DefaultScene,
		name: 'Hytale',
        category: 'hytale',
        cubemap: [
            base_path + "skybox_0.webp",
            base_path + "skybox_1.webp",
            base_path + "skybox_2.webp",
            base_path + "skybox_3.webp",
            base_path + "skybox_4.webp",
            base_path + "skybox_5.webp"
        ]
    });
	


    let player_model = new PreviewModel('hytale_player', {
		...PlayerModelJSON,
		texture: PlayerTexture,
    });
	// track(player_model); // Currently has an unloading bug in Blockbench

	ViewOptionsDialog.form_config.hytale_player = {
		label: 'Hytale Player',
		type: 'checkbox',
		style: 'toggle_switch',
		condition: {formats: FORMAT_IDS}
	}
	if (!ViewOptionsDialog.form) {
		ViewOptionsDialog.build();
	} else {
		ViewOptionsDialog.form.buildForm();
	}
	ViewOptionsDialog.form.on('change', (arg) => {
		if (arg.result.hytale_player) {
			player_model.enable();
			updateSizes();
		} else {
			player_model.disable();
		}
	})
	
	function updateSizes() {
		// Player
		let block_size = Format?.block_size ?? 64;
		player_model.model_3d.scale.set(block_size/64, block_size/64, block_size/64);
		player_model.model_3d.position.x = -block_size;
		// Scene
		// @ts-ignore
		let model = PreviewModel.models.hytale_default as PreviewModel;
		model.model_3d.scale.set(block_size/16, block_size/16, block_size/16);
	}
	track( Blockbench.on('select_format', updateSizes) );
	
}