// 왼쪽 메뉴. 앱을 추가하면 여기에 한 줄을 넣는다.
// visible(user) 가 있으면 그 사용자에게 보일 때만 그린다. (메뉴를 숨기는 것은 편의일 뿐, 권한 검사는 각 경로가 따로 한다.)
import { canManageUsers, canReadAudit } from './policy.js';

export const MENU = [
  { key: 'home', label: '홈', href: '/' },
  { key: 'boards', label: '게시판', href: '/boards' },
  { key: 'admin', label: '관리', href: '/admin/users', visible: canManageUsers },
  { key: 'audit', label: '기록', href: '/audit', visible: canReadAudit },
];
