
declare module "*.png" {
	const value: string;
	export default value;
}
declare module "*.json" {
	const val: any;
	export default val;
}
// Blockbench passes keep_uuid through, the types omit it
interface Group {
	getChildlessCopy(keep_uuid?: boolean): Group
}
