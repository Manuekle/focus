"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Card } from "@/app/_components/dashboard-card";

export function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <div className="space-y-4 p-5">
              <SkeletonBar width="45%" />
              <SkeletonBar className="h-6" />
              <SkeletonBar width="60%" />
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="space-y-3 p-5">
          <SkeletonBar width="30%" />
          <SkeletonBar className="h-40" />
        </div>
      </Card>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-5">
          <SkeletonBar width="30%" />
          <SkeletonBar className="h-10" />
          <SkeletonBar />
          <SkeletonBar />
          <SkeletonBar width="80%" />
        </div>
      </Card>
    </div>
  );
}
