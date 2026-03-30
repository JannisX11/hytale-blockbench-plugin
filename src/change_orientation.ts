import { track } from "./cleanup";

function canChangeParentGroup(cube: Cube): boolean {
    let parent = cube.parent;
    if (parent instanceof Group == false || !parent.selected) return false;
    if (parent.children.find(c => (c instanceof Cube == false || !c.selected))) return false;
    return true;
}

function changeCubeOrientation(axis: 0|1|2, direction: number) {
    let affected_groups = [];
    let changed_groups = [];
    for (let cube of Cube.selected) {
        if (canChangeParentGroup(cube)) affected_groups.safePush(cube.parent);
    }
	Undo.initEdit({elements: Cube.selected, groups: affected_groups});

    for (let cube of Cube.selected) {
        let flip_direction = (direction == -1);
        if (axis == 1) flip_direction = !flip_direction;

        let node_to_rotate = canChangeParentGroup(cube) ? cube.parent as Group : cube;
        let quat_initial = Reusable.quat2.copy(node_to_rotate.mesh.quaternion);
        cube.roll(axis, flip_direction ? 3 : 1, node_to_rotate.origin);

        if (changed_groups.includes(node_to_rotate)) {
            continue;
        } else if (node_to_rotate instanceof Group) {
            changed_groups.push(node_to_rotate);
        }

        let change_euler = Reusable.euler1.set(0, 0, 0);
        change_euler[getAxisLetter(axis)] = Math.degToRad(-direction * 90);
        node_to_rotate.mesh.quaternion.multiplyQuaternions(quat_initial, Reusable.quat1.setFromEuler(change_euler));
        let new_rotation = node_to_rotate.mesh.rotation.toArray().slice(0, 3).map(r => Math.radToDeg(r));
        node_to_rotate.rotation.V3_set(new_rotation.map(r => Math.roundTo(r, 2)) as ArrayVector3);
        node_to_rotate.preview_controller.updateTransform(node_to_rotate);
    };
	Undo.finishEdit('Change cube orientation');
    updateSelection();
}

export function setupChangeOrientation() {
    let action = new Action('change_cube_orientation', {
        name: 'Change Orientation',
        icon: 'screen_rotation_up',
        condition: {modes: ['edit'], selected: {cube: true}},
        children: [
            {
                id: 'x_plus', name: 'X+',
                icon: 'rotate_right', color: 'x',
                click() {
                    changeCubeOrientation(0, 1);
                }
            },
            {
                id: 'x_minus', name: 'X-',
                icon: 'rotate_left', color: 'x',
                click() {
                    changeCubeOrientation(0, -1);
                }
            },
            {
                id: 'y_plus', name: 'Y+',
                icon: 'rotate_right', color: 'y',
                click() {
                    changeCubeOrientation(1, 1);
                }
            },
            {
                id: 'y_minus', name: 'Y-',
                icon: 'rotate_left', color: 'y',
                click() {
                    changeCubeOrientation(1, -1);
                }
            },
            {
                id: 'z_plus', name: 'Z+',
                icon: 'rotate_right', color: 'z',
                click() {
                    changeCubeOrientation(2, 1);
                }
            },
            {
                id: 'z_minus', name: 'Z-',
                icon: 'rotate_left', color: 'z',
                click() {
                    changeCubeOrientation(2, -1);
                }
            }
        ],
        click(e) {
            new Menu('change_cube_orientation', this.children, {}).open(e.target as HTMLElement);
        }
    })
    for (let item of (action.children as MenuItem[])) {
        action.addSubKeybind(item.id, item.name, null, item.click);
    }
    MenuBar.menus.transform.addAction(action);
    track(action);
}
