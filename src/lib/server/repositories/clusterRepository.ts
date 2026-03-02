import type { Cluster, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export class ClusterRepository {
	async list(): Promise<Cluster[]> {
		return prisma.cluster.findMany({
			orderBy: { createdAt: 'asc' }
		});
	}

	async findById(id: string): Promise<Cluster | null> {
		return prisma.cluster.findUnique({
			where: { id }
		});
	}

	async create(data: Prisma.ClusterCreateInput): Promise<Cluster> {
		return prisma.cluster.create({ data });
	}

	async update(id: string, data: Prisma.ClusterUpdateInput): Promise<Cluster> {
		return prisma.cluster.update({
			where: { id },
			data
		});
	}

	async delete(id: string): Promise<void> {
		await prisma.cluster.delete({
			where: { id }
		});
	}
}

export const clusterRepository = new ClusterRepository();
