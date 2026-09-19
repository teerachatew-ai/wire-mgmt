import { useLayoutEffect } from 'react';

/* ล็อกการเลื่อนหน้าหลักระหว่างเปิดกล่อง pop-up แล้วคืนตำแหน่งเดิมเป๊ะตอนปิด
   หน้าหลักเลื่อนด้วย <main id="app-scroll"> (ไม่ใช่ window) และกล่อง pop-up ที่เป็น fixed ยังอยู่ใต้ main ใน DOM
   เวลาเลื่อน trackpad บนพื้นหลังมืด หรือเลื่อนในกล่องจนสุดแล้วมีแรงเหวี่ยงต่อ (เจอบ่อยบน MacBook)
   มันจะไปเลื่อนหน้าหลักข้างหลังแทน ปิดกล่องแล้วเลยเจอหน้าเลื่อนไปล่างสุด
   ซ้อนกันหลายกล่องได้ (เช่นกล่องรายละเอียดเปิดทับกล่องแก้จำนวน) — แต่ละกล่องจำค่าเดิมของตัวเองไว้คืน */
export function useScrollLock() {
  useLayoutEffect(() => {
    const el = document.getElementById('app-scroll');
    if (!el) return;
    const top = el.scrollTop;
    const prevOverflow = el.style.overflow;
    const prevPadding = el.style.paddingRight;
    const scrollbar = el.offsetWidth - el.clientWidth;   // กันเนื้อหาข้างหลังขยับตอนแถบเลื่อนหายไป (Windows)
    el.style.overflow = 'hidden';
    if (scrollbar > 0) el.style.paddingRight = `${scrollbar}px`;
    return () => {
      el.style.overflow = prevOverflow;
      el.style.paddingRight = prevPadding;
      el.scrollTop = top;
    };
  }, []);
}
