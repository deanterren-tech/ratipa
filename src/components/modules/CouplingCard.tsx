/**
 * CouplingCard — историческое имя ПОЛНОЙ карточки автомобиля.
 *
 * Реализация одна на весь портал: ./VehicleCard (единый механизм загрузки по
 * vehicleId). Файл оставлен, чтобы старые импорты не тянули вторую, урезанную
 * версию карточки.
 */
export { default } from './VehicleCard';
export type { VehicleCardProps } from './VehicleCard';
