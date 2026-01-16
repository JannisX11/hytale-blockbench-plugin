//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";
import { updateUVSize } from "./texture";
import { getMainShape } from "./util";

const MAX_NODE_COUNT = 255;
function getNodeCount() {
    let node_count = 0;
    for (let group of Group.all) {
        if (group.export == false) return;
        if (Collection.all.find(c => c.contains(group))) continue;
        node_count++;
        let main_shape = getMainShape(group);
        for (let cube of group.children) {
            if (cube instanceof Cube == false || cube.export == false) continue;
            if (cube == main_shape) continue;
            node_count++;
        }
    }
    return node_count;
}

export function setupChecks() {
    let check = new ValidatorCheck('hytale_node_count', {
        update_triggers: ['update_selection'],
        condition: {formats: FORMAT_IDS},
        run(this: ValidatorCheck) {
            let node_count = getNodeCount();
            if (node_count > MAX_NODE_COUNT) {
                this.fail({
                    message: `The model contains ${node_count} nodes, which exceeds the maximum of ${MAX_NODE_COUNT} that Hytale will display.`
                });
            }
        }
    })
    check.name = 'Hytale Node Count';
    track(check);

    let uv_check = new ValidatorCheck('hytale_uv_size', {
        update_triggers: ['update_selection'],
        condition: {formats: FORMAT_IDS},
        run(this: ValidatorCheck) {
            for (let texture of Texture.all) {
                if (texture.uv_width != texture.width || texture.uv_height != texture.height) {
                    this.fail({
                        message: `The texture ${texture.name} has a resolution (${texture.width}x${texture.height}) that does not match its UV size (${texture.uv_width}x${texture.uv_height}). Ensure that your pixel density is 64 for characters and 32 for props.`,
                        buttons: [
                            {
                                name: 'Fix UV Size',
                                icon: 'build',
                                click() {
                                    updateUVSize(texture);
                                    texture.select();
                                }
                            }
                        ]
                    });
                }
            }
        }
    })
    uv_check.name = 'Hytale UV Size';
    track(uv_check);

	let listener = Blockbench.on('display_model_stats', ({stats}) => {
        if (!FORMAT_IDS.includes(Format.id)) return;
        let node_count = getNodeCount();
        stats.splice(0, 0, {label: 'Nodes', value: node_count + ' / ' + MAX_NODE_COUNT})
    });
    track(listener);
}
