"""本机验收入口；不自动收费，generate 必须显式执行。"""

import argparse
import asyncio
from pathlib import Path
from uuid import UUID

from backend.app.budget import Budget
from backend.app.config import Settings
from backend.app.errors import AppError
from backend.app.model import DeepSeek
from backend.app.schemas import CreateTask, Task, markdown
from backend.app.service import OutlineService
from backend.app.store import Store


def run():
    parser = argparse.ArgumentParser(description="氢能九章大纲｜本机验收")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="从脱敏/公开描述文件创建报告，不调用模型")
    create.add_argument("description_file", type=Path)
    create.add_argument("--name", default="氢能项目大纲")
    generate = commands.add_parser("generate", help="显式调用模型，提取信息并生成大纲")
    generate.add_argument("task_id", type=UUID)
    export = commands.add_parser("export", help="导出已生成的大纲，不调用模型")
    export.add_argument("task_id", type=UUID)
    commands.add_parser("check", help="检查配置状态，不显示密钥或调用模型")
    args = parser.parse_args()
    try:
        settings = Settings.load()
        if args.command == "check":
            print("模型：" + settings.model)
            print("密钥：" + ("已配置（可用性待验）" if settings.api_key else "未配置"))
            try:
                settings.check_call()
                print("调用前配置检查：通过（未发起收费调用）")
            except AppError as exc:
                print("调用前配置检查：" + exc.message)
            return
        store = Store(settings.data_dir)
        store.acquire()
        try:
            store.recover()
            if args.command == "create":
                if args.description_file.stat().st_size > 16_000:
                    raise AppError("INVALID_REQUEST", "描述文件过大。")
                body = CreateTask(
                    description=args.description_file.read_text(encoding="utf-8"), name=args.name
                )
                task = Task(name=body.name, description=body.description)
                store.save(task)
                print("报告已创建，任务 ID：" + str(task.id))
                return
            task = store.get(args.task_id)
            if args.command == "generate":
                budget = Budget(store, settings)
                service = OutlineService(store, settings, DeepSeek(settings, budget))
                claimed = service.claim(task.id)

                async def consume():
                    async for event, data in service.generate(claimed):
                        if event == "error":
                            raise AppError(data["error"]["code"], data["error"]["message"])
                    return store.get(task.id)

                task = asyncio.run(consume())
            if not task.versions:
                raise AppError("OUTLINE_NOT_READY", "尚无有效大纲，请先生成。")
            output = store.root / "exports" / str(task.id)
            output.mkdir(parents=True, exist_ok=True, mode=0o700)
            md_path = output / "outline.md"
            md_path.write_text(markdown(task), encoding="utf-8")
            md_path.chmod(0o600)
            json_path = output / "outline.json"
            store.write(json_path, task.versions[-1].outline)
            print("大纲文件：" + str(md_path))
            print("结构数据：" + str(json_path))
        finally:
            store.release()
    except AppError as exc:
        print(f"{exc.code}：{exc.message}")
        raise SystemExit(1) from None
    except Exception:
        print("操作失败，请核对文件格式与本地配置；已有任务数据保留。")
        raise SystemExit(1) from None


if __name__ == "__main__":
    run()
