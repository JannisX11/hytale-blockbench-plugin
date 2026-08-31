import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";
import FirstPersonModel from './references/first_person_player.json'

export function setupFirstPerson() {
    
    // MARK: First person camera
    Blockbench.addCSS(`
        #reset_camera_button {
            position: absolute;
            margin: auto;
            right: 0;
            left: 0;
            bottom: 7px;
            width: fit-content;
            z-index: 2;
        }
    `);
    let resetCamera: () => void | undefined;
    let hytale_first_person_camera = new Action('hytale_first_person_camera', {
        name: 'Hytale First Person Camera',
        icon: 'video_camera_front',
        condition: {formats: FORMAT_IDS},
        keybind: new Keybind({key: 96}),
        click() {
            if (resetCamera) resetCamera();

            let preview = Preview.selected;
            preview.loadAnglePreset({
                position: [0, 0, 0],
                target: [0, 0, -64],
                fov: 70,
                projection: 'perspective',
                aspect_ratio: 16/9
            });
            preview.setFOV(80);
            preview.controls.enableRotate = false;
            preview.controls.enablePan = false;
            preview.controls.enableZoom = false;

            let reset_camera_button = Interface.createElement('button', {id: 'reset_camera_button'}, 'Reset View');
            reset_camera_button.addEventListener('click', event => resetCamera());
			Interface.preview.append(reset_camera_button);
            
            resetCamera = () => {
                resetCamera = undefined;
                preview.loadAnglePreset(DefaultCameraPresets[0])
                preview.controls.enableRotate = true;
                preview.controls.enablePan = true;
                preview.controls.enableZoom = true;
                reset_camera_button.remove();
            }
        }
    });
    track(hytale_first_person_camera);
    MenuBar.menus.view.addAction(hytale_first_person_camera, '#model');

    let original_setLockedAngle = Preview.prototype.setLockedAngle;
    Preview.prototype.setLockedAngle = function(angle: number | undefined): Preview {
        if (resetCamera && angle == undefined) {
            resetCamera();
        }
        return original_setLockedAngle.call(this, angle);
    };


    // MARK: Build-in model
    const player_loader = new ModelLoader('hytale_first_person_character', {
		name: 'Hytale First Person Character',
		description: 'Default character rig as reference for first person animations',
		show_on_start_screen: false,
		icon: 'swords',
		target: 'Hytale',
		onStart: async function() {
            Codecs.blockymodel.load(FirstPersonModel, {path: '', name: 'FirstPersonModel.blockymodel', no_file: true});
		}
	})
}
