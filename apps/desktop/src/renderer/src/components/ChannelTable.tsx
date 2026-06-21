import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import type { ChannelGroup } from "@m3u-mixer/shared";

const columnHelper = createColumnHelper<ChannelGroup>();

type ChannelTableProps = {
  groups: ChannelGroup[];
  selectedVideoGroupId: string | null;
  selectedAudioGroupId: string | null;
  onPickVideo: (groupId: string) => void;
  onPickAudio: (groupId: string) => void;
};

export function ChannelTable(props: ChannelTableProps) {
  const columns = useMemo(
    () => [
      columnHelper.accessor("displayName", {
        header: "名称",
        cell: (info) => info.getValue()
      }),
      columnHelper.display({
        id: "available",
        header: "当前可用",
        cell: (info) => (info.row.original.aggregateHealth.available ? "可用" : "不可用")
      }),
      columnHelper.accessor((row) => row.aggregateHealth.continuousAvailableSeconds, {
        id: "continuousAvailableSeconds",
        header: "连续可用",
        cell: (info) => `${Math.floor(info.getValue() / 60)}m`
      }),
      columnHelper.accessor((row) => row.aggregateHealth.successRate24h, {
        id: "successRate24h",
        header: "24h成功率",
        cell: (info) => `${Math.round(info.getValue() * 100)}%`
      }),
      columnHelper.accessor((row) => row.aggregateHealth.bestStartupLatencyMs, {
        id: "latency",
        header: "延迟",
        cell: (info) => `${info.getValue() ?? "-"}ms`
      }),
      columnHelper.accessor("candidateCount", {
        header: "候选数",
        cell: (info) => info.getValue()
      }),
      columnHelper.accessor("sourceCount", {
        header: "源数",
        cell: (info) => info.getValue()
      }),
      columnHelper.display({
        id: "actions",
        header: "角色",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="role-actions">
              <button
                className={props.selectedVideoGroupId === row.id ? "role-button active" : "role-button"}
                onClick={() => props.onPickVideo(row.id)}
              >
                视频
              </button>
              <button
                className={props.selectedAudioGroupId === row.id ? "role-button active" : "role-button"}
                onClick={() => props.onPickAudio(row.id)}
              >
                音频
              </button>
            </div>
          );
        }
      })
    ],
    [props.selectedAudioGroupId, props.selectedVideoGroupId, props.onPickAudio, props.onPickVideo]
  );

  const table = useReactTable({
    data: props.groups,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="table-shell">
      <table className="channel-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
