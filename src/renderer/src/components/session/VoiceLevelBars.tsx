import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { smoothVoiceLevel } from "../../utils/voiceLevelMeter";

const BAR_SIZE_PX = 13;
/** 每根柱对同一电平的响应系数：中间灵敏、两端略钝，起伏自然而不是一齐伸缩。 */
const BAR_SHAPES = [0.5, 0.8, 1, 0.75, 0.55];
/** 无声时的柱高比例：留一截短柱而不是压成 0，否则胶囊看起来像消失了。 */
const REST_SCALE = 0.18;
/** 采样间隔：视觉反馈约 25fps 已顺眼，省下每帧读 analyser 缓冲的开销。 */
const LEVEL_INTERVAL_MS = 40;

export function VoiceLevelBars(props: { readLevel: () => number; label: string; className?: string }) {
	const reduce = useReducedMotion() ?? false;
	const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
	const levelsRef = useRef<number[]>(BAR_SHAPES.map(() => 0));
	useEffect(() => {
		// 降级运动偏好下不跟电平跳动：静止短柱 + 红底胶囊已足以表达「正在录音」。
		if (reduce) return undefined;
		let frame = 0;
		let lastSample = 0;
		const step = (now: number) => {
			frame = requestAnimationFrame(step);
			if (now - lastSample < LEVEL_INTERVAL_MS) return;
			lastSample = now;
			const level = props.readLevel();
			for (const [index, shape] of BAR_SHAPES.entries()) {
				const previous = levelsRef.current[index] ?? 0;
				const next = smoothVoiceLevel(previous, Math.min(1, level * shape));
				levelsRef.current[index] = next;
				const bar = barsRef.current[index];
				if (bar) bar.style.transform = `scaleY(${(REST_SCALE + next * (1 - REST_SCALE)).toFixed(3)})`;
			}
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [props.readLevel, reduce]);

	return (
		<span role="status" aria-label={props.label} className={`flex items-center ${props.className ?? ""}`} style={{ gap: BAR_SIZE_PX * 0.1, height: BAR_SIZE_PX }}>
			{BAR_SHAPES.map((shape, index) => (
				<span
					key={shape}
					ref={(node) => {
						barsRef.current[index] = node;
					}}
					className="rounded-full bg-current"
					style={{
						width: BAR_SIZE_PX * 0.16,
						height: BAR_SIZE_PX,
						transformOrigin: "center",
						transform: `scaleY(${reduce ? 0.4 : REST_SCALE})`,
					}}
				/>
			))}
		</span>
	);
}
