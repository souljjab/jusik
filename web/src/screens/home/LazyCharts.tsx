import { lazy, Suspense, type ComponentProps } from "react";
import { Skeleton } from "../../ui";
import type { BreadthChart as BreadthChartT } from "./BreadthChart";
import type { IndexChart as IndexChartT } from "./IndexChart";

/*
 * 차트(lightweight-charts)는 필요할 때 불러온다. 핸드폰 홈에는 차트가 없어 첫 화면을 가볍게 둔다.
 */
const IndexChartLazy = lazy(() => import("./IndexChart").then((m) => ({ default: m.IndexChart })));
const BreadthChartLazy = lazy(() => import("./BreadthChart").then((m) => ({ default: m.BreadthChart })));

export function IndexChart(props: ComponentProps<typeof IndexChartT>) {
  return (
    <Suspense fallback={<Skeleton h={props.height ?? 180} />}>
      <IndexChartLazy {...props} />
    </Suspense>
  );
}

export function BreadthChart(props: ComponentProps<typeof BreadthChartT>) {
  return (
    <Suspense fallback={<Skeleton h={240} />}>
      <BreadthChartLazy {...props} />
    </Suspense>
  );
}
