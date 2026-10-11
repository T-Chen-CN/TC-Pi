import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "../components/motion/tabs";
import { cn } from "../lib/utils";

export type ContentTabItem = {
	value: string;
	label: string;
	/** 可选图标（lucide 组件元素），如商店 tab 的 ShoppingBag。 */
	icon?: ReactNode;
};

export function ContentTabs(props: {
	value: string;
	onValueChange: (value: string) => void;
	items: ContentTabItem[];
	/** 紧凑版（面板内二级切换）：text-xs + 更矮的 trigger。 */
	compact?: boolean;
	/** 是否在横向容器中撑满（默认 true）；纵向容器（flex-col）内传 false 防止竖向拉伸。 */
	fill?: boolean;
	/** 追加到 TabsList 的类。 */
	className?: string;
}) {
	const { value, onValueChange, items, compact = false, fill = true, className } = props;
	return (
		<Tabs value={value} onValueChange={onValueChange} variant="underline" className={cn("min-w-0", fill && "flex-1")}>
			<TabsList className={cn("w-full justify-start gap-0", className)}>
				{items.map((item) => (
					<TabsTrigger
						key={item.value}
						value={item.value}
						// 覆盖 beui 默认尺寸（min-h-[44px] text-sm）到应用控件节奏；
						// 指示器 2px（h-0.5）与旧 line variant 的 border-b-2 视觉一致。
						className={cn("min-h-0 gap-1.5 px-3 py-2 text-control font-medium", compact && "px-3 py-1.5 text-xs")}
						indicatorClassName="h-0.5"
					>
						{item.icon}
						{item.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
