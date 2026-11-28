"""Local operator CLI, requiring trusted database access; never an HTTP admin key.

Do not expose this command or its output to untrusted users. No automatic hiding
based on report counts: reports are allegations, not established violations.
"""
import argparse
import json
import os

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from knowlm.database import make_engine
from knowlm.sharing import LearningShare, ShareReport, now


def resolve(session, report_id, action):
    if action not in ('dismiss', 'revoke'):
        raise ValueError('Unknown moderation action')
    report=session.get(ShareReport,report_id)
    if not report: raise ValueError('Report not found')
    # Same lock as import: an import either finishes before revocation or fails.
    session.execute(update(LearningShare).where(LearningShare.id==report.share_id).values(title=LearningShare.title))
    session.expire_all()
    report=session.get(ShareReport,report_id)
    if not report: raise ValueError('Report no longer available')
    if report.status!='pending': raise ValueError('Report already resolved')
    if action=='revoke':
        share=session.get(LearningShare,report.share_id)
        if not share: raise ValueError('Share no longer available')
        share.revoked_at=now()
        share.snapshot={'kind':share.snapshot['kind'],'items':[]}
    report.status='actioned' if action=='revoke' else 'dismissed'
    report.resolved_at=now()
    session.commit()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('pending')
    show=sub.add_parser('show');show.add_argument('report_id')
    for name in ('dismiss','revoke'):
        command=sub.add_parser(name);command.add_argument('report_id')
    args=parser.parse_args()
    url=os.getenv('DATABASE_URL')
    if not url: parser.error('Set DATABASE_URL explicitly to the intended database')
    engine=make_engine(url)
    try:
        with Session(engine) as session:
            if args.command=='pending':
                rows=session.scalars(select(ShareReport).where(ShareReport.status=='pending').order_by(ShareReport.created_at,ShareReport.id).limit(100))
                print(json.dumps([{'id':r.id,'reason':r.reason,'created_at':r.created_at.isoformat()} for r in rows]))
            elif args.command=='show':
                report=session.get(ShareReport,args.report_id)
                if not report: parser.error('Report not found')
                share=session.get(LearningShare,report.share_id)
                print(json.dumps({'reason':report.reason,'status':report.status,'title':share.title,'snapshot':share.snapshot},ensure_ascii=True))
            else:
                try: resolve(session,args.report_id,args.command)
                except ValueError as e: parser.error(str(e))
                print('Resolved')
    finally: engine.dispose()


if __name__=='__main__': main()
