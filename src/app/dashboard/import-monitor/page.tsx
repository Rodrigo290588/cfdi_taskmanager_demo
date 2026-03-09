'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  Database, 
  Zap, 
  Clock, 
  CheckCircle2, 
  AlertCircle 
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MonitorStats {
  total: number;
  recent: {
    id_uuid: string;
    rfc_emisor: string;
    fecha: string;
  }[];
  timestamp: number;
}

export default function ImportMonitorPage() {
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [speed, setSpeed] = useState(0);
  const [targetCount, setTargetCount] = useState(1000); // Default target for progress bar
  const [isLive, setIsLive] = useState(false);
  const lastStatsRef = useRef<MonitorStats | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/monitor/stats');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: MonitorStats = await res.json();
        
        if (lastStatsRef.current) {
          const diff = data.total - lastStatsRef.current.total;
          const timeDiff = (data.timestamp - lastStatsRef.current.timestamp) / 1000;
          if (timeDiff > 0) {
            const currentSpeed = Math.max(0, Math.round(diff / timeDiff));
            setSpeed(currentSpeed);
            setIsLive(currentSpeed > 0);
          }
        }
        
        lastStatsRef.current = data;
        setStats(data);
      } catch (error) {
        console.error(error);
        setIsLive(false);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 1s
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  const progressPercentage = stats ? Math.min(100, (stats.total / targetCount) * 100) : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Monitor de Importación</h1>
          <p className="text-muted-foreground">
            Visualización en tiempo real del proceso de ingesta de CFDI
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive ? (
            <Badge variant="default" className="bg-green-500 hover:bg-green-600 animate-pulse">
              <Activity className="mr-1 h-3 w-3" /> EN VIVO
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Clock className="mr-1 h-3 w-3" /> IDLE
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Registros
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">
              Documentos almacenados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Velocidad de Ingesta
            </CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{speed} docs/s</div>
            <p className="text-xs text-muted-foreground">
              Promedio últimos segundos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Estado del Sistema
            </CardTitle>
            {isLive ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-gray-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLive ? "Procesando" : "En Espera"}
            </div>
            <p className="text-xs text-muted-foreground">
              {isLive ? "Recepción activa de datos" : "Sin actividad reciente"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Meta Estimada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <input 
                type="number" 
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="w-full bg-transparent border-b border-gray-300 focus:outline-none focus:border-blue-500 text-2xl font-bold"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ajustar objetivo manual
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Progreso General</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{stats?.total || 0} de {targetCount}</span>
              <span>{progressPercentage.toFixed(1)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-4" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Últimos Registros Procesados</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>UUID</TableHead>
                  <TableHead>RFC Emisor</TableHead>
                  <TableHead>Fecha Emisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.recent.map((record) => (
                  <TableRow key={record.id_uuid}>
                    <TableCell className="font-mono text-xs">{record.id_uuid}</TableCell>
                    <TableCell>{record.rfc_emisor}</TableCell>
                    <TableCell>{new Date(record.fecha).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!stats?.recent.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      Esperando datos...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
