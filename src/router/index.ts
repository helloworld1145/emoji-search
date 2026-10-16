import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      // 首次启动直接进首页（已移除引导页，由首页空状态引导用户选择文件夹）
      path: '/',
      redirect: '/home'
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('../views/Home.vue'),
      meta: { title: '表情包' }
    },
    {
      path: '/collection/:id',
      name: 'collection-detail',
      component: () => import('../views/CollectionDetail.vue'),
      meta: { hideNav: true, title: '收藏夹' }
    },
    {
      path: '/collections',
      name: 'collections',
      component: () => import('../views/Collections.vue'),
      meta: { title: '收藏夹' }
    },
    {
      path: '/emoji/:id',
      name: 'emoji-detail',
      component: () => import('../views/EmojiDetail.vue'),
      meta: { hideNav: true, title: '表情详情' }
    },
    {
      path: '/trash',
      name: 'trash',
      component: () => import('../views/Trash.vue'),
      meta: { hideNav: true, title: '回收站' }
    },
    {
      path: '/mine',
      name: 'mine',
      component: () => import('../views/Mine.vue'),
      meta: { title: '我的' }
    }
  ]
})

export default router
