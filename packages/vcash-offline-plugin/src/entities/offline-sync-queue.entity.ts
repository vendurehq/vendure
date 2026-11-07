import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['idempotencyKey'], { unique: true })
export class OfflineSyncQueue {
  @PrimaryGeneratedColumn() id!: number;

  // 显式声明 column type，避免依赖 emitDecoratorMetadata（vitest/esbuild 不输出 design:type）
  @Column({ type: 'varchar', unique: true }) idempotencyKey!: string;
  @Column({ type: 'varchar' }) type!: 'order' | 'payment' | 'session';
  @Column({ type: 'json' }) payload!: any;
  @Column({ type: 'timestamptz' }) clientCreatedAt!: Date;
  @Column({ type: 'timestamptz' }) clientUpdatedAt!: Date;

  @Column({ type: 'varchar', default: 'pending' }) status!: string;
  @Column({ nullable: true, type: 'int' }) syncedOrderId?: number;
  @Column({ nullable: true, type: 'varchar' }) syncedOrderCode?: string;
  @Column({ nullable: true, type: 'json' }) syncError?: { code: string; message: string } | null;
  @Column({ type: 'int', default: 0 }) retryCount!: number;
  @Column({ nullable: true, type: 'timestamptz' }) syncedAt?: Date;
  @Column({ nullable: true, type: 'varchar' }) sessionCode?: string;
}
